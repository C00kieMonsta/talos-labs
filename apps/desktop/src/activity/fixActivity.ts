import type { ActivityEvent, ActivityKind, ActivityOutcome, ActivityStatus, BatchPlan, FixError, RuleId } from "@talos/core";
import type { FixingState } from "../scan/machine";

type Single = Extract<FixingState, { kind: "single" }>;
type Batch = Extract<FixingState, { kind: "batch" }>;

/** Errors raised before anything ran: the preparing row is the one that fails. */
const PRE_RUN: readonly FixError[] = ["plan_expired", "precondition_changed", "not_in_catalog", "invalid_choice", "invalid_input", "busy"];

interface Extras {
  readonly ruleId?: RuleId | null;
  readonly count?: number | null;
  readonly step?: number | null;
  readonly of?: number | null;
  readonly outcome?: ActivityOutcome;
}

function row(cardId: string, now: number, id: string, kind: ActivityKind, status: ActivityStatus, extras: Extras = {}): ActivityEvent {
  return {
    id: `${cardId}:${id}`,
    cardId,
    kind,
    status,
    at: now,
    endedAt: status === "running" ? null : now,
    ruleId: extras.ruleId ?? null,
    count: extras.count ?? null,
    step: extras.step ?? null,
    of: extras.of ?? null,
    probeId: null,
    sectionKey: null,
    outcome: extras.outcome ?? null,
    modelLine: null,
  };
}

function isAdminItem(item: BatchPlan["items"][number]): boolean {
  return item.lines.some((line) => line.privilege === "admin");
}

function single(cardId: string, f: Single, now: number): ActivityEvent[] {
  const prep = (status: ActivityStatus, outcome: ActivityOutcome = null) => row(cardId, now, "preparing", "preparing", status, { outcome });
  const fix = (status: ActivityStatus, outcome: ActivityOutcome) => row(cardId, now, "fixing", "fixing", status, { ruleId: f.plan.ruleId, step: f.step, of: f.of, outcome });
  const check = (status: ActivityStatus, outcome: ActivityOutcome = null) => row(cardId, now, "rechecking", "rechecking", status, { count: f.plan.recheck.length, outcome });
  switch (f.phase) {
    case "confirm":
      return [prep("running")];
    case "waiting_for_password":
      return [prep("done"), fix("running", "waiting_for_password")];
    case "running":
      // Rust emits nothing between the dialog and the outcome, so an admin fix keeps "your password" here.
      return [prep("done"), fix("running", f.plan.needsPassword ? "waiting_for_password" : null)];
    case "rechecking":
      return [prep("done"), fix("done", null), check("running")];
    case "done":
      return [prep("done"), fix("done", null), f.result === "pass" || f.result === null ? check("done", f.result) : check("failed", f.result)];
    case "failed": {
      const error = f.error ?? "command_failed";
      return PRE_RUN.includes(error) ? [prep("failed", error)] : [prep("done"), fix("failed", error)];
    }
  }
}

function batch(cardId: string, f: Batch, now: number): ActivityEvent[] {
  const items = f.plan.items;
  const adminCount = items.filter(isAdminItem).length;
  const prep = (status: ActivityStatus, outcome: ActivityOutcome = null) => row(cardId, now, "preparing", "preparing", status, { outcome });
  const admin = (status: ActivityStatus, outcome: ActivityOutcome) => row(cardId, now, "fixing", "fixing", status, { ruleId: null, count: adminCount, outcome });
  const check = (status: ActivityStatus, outcome: ActivityOutcome = null) => row(cardId, now, "rechecking", "rechecking", status, { count: f.plan.recheck.length, outcome });
  const itemRow = (index: number, status: ActivityStatus, outcome: ActivityOutcome, step: number | null = null, of: number | null = null) => {
    const item = items[index];
    if (item === undefined) return null;
    return row(cardId, now, `fixing:${item.ruleId}`, "fixing", status, { ruleId: item.ruleId, step, of, outcome });
  };
  // The recheck row fails only when no item passed; the verdicts land with batch_done.
  const verdicts = Object.values(f.byRule);
  const checkOutcome: ActivityOutcome = verdicts.length === 0 || verdicts.some((v) => v === "pass") ? null : verdicts.every((v) => v === "unreadable") ? "unreadable" : "still_failing";
  const checked = () => check(checkOutcome === null ? "done" : "failed", checkOutcome);
  // Rows the batch has reported so far: the admin block, then the user-level items up to `f.item`.
  const reported = (last: number | null): ActivityEvent[] => {
    const out: ActivityEvent[] = [prep("done")];
    if (f.plan.needsPassword) {
      // Rust reads one R marker per admin item; the block fails only when none of them changed, the result rows carry the rest.
      const adminOutcomes = (f.outcome?.items ?? []).filter((o) => items.some((i) => i.ruleId === o.ruleId && isAdminItem(i)));
      const adminFailed = adminOutcomes.find((o) => o.status === "failed") ?? null;
      const anyDone = adminOutcomes.some((o) => o.status === "done");
      out.push(adminFailed === null || anyDone ? admin("done", null) : admin("failed", adminFailed.error ?? "command_failed"));
    }
    if (last === null) return out;
    for (let i = 0; i <= last; i += 1) {
      const item = items[i];
      if (item === undefined || isAdminItem(item)) continue;
      const result = f.outcome?.items.find((o) => o.ruleId === item.ruleId) ?? null;
      const failed = result !== null && result.status === "failed";
      const r = itemRow(i, failed ? "failed" : "done", failed ? (result.error ?? "command_failed") : null);
      if (r !== null) out.push(r);
    }
    return out;
  };
  const current = f.item !== null ? items[f.item] : undefined;
  switch (f.phase) {
    case "confirm":
      return [prep("running")];
    case "waiting_for_password":
      return [prep("done"), admin("running", "waiting_for_password")];
    case "running": {
      if (f.item === null || current === undefined || isAdminItem(current)) {
        return f.plan.needsPassword ? [prep("done"), admin("running", "waiting_for_password")] : [prep("running")];
      }
      // Rust counts steps inside the item (batch.rs emits j + 1 of the item's steps).
      const running = itemRow(f.item, "running", null, Math.max(1, f.step), f.of);
      return [...reported(f.item - 1), ...(running === null ? [] : [running])];
    }
    case "rechecking":
      return [...reported(f.item), check("running")];
    case "done":
      return [...reported(f.item), checked()];
    case "failed": {
      if (f.error === null) return [...reported(f.item), checked()];
      if (PRE_RUN.includes(f.error)) return [prep("failed", f.error)];
      if (current !== undefined && !isAdminItem(current) && f.item !== null) {
        const failedRow = itemRow(f.item, "failed", f.error);
        return [...reported(f.item - 1), ...(failedRow === null ? [] : [failedRow])];
      }
      return f.plan.needsPassword ? [prep("done"), admin("failed", f.error)] : [prep("failed", f.error)];
    }
  }
}

/**
 * The upserts for the fix's current phase; the reducer keeps `at` from first sight.
 * Never emits a row for a phase that has not been reported.
 */
export function fixEvents(input: { cardId: string; fixing: FixingState | null; preparing: boolean; now: number }): readonly ActivityEvent[] {
  const { cardId, fixing, preparing, now } = input;
  if (fixing === null) return preparing ? [row(cardId, now, "preparing", "preparing", "running")] : [];
  return fixing.kind === "single" ? single(cardId, fixing, now) : batch(cardId, fixing, now);
}
