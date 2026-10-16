import type { GuidedStep, RuleId } from "@talos/core";
import { convertedShowStep } from "@talos/core";
import type { FixingState } from "../scan/machine";
import type { Core } from "./core";
import { advance, appendSteps, markFixed, setStep } from "./core";
import { DONE_PREFIX, END, FIX, PLAN, STATUS } from "./copy";
import { guidedFor, paneFor } from "./plan";
import type { DoneRow } from "./state";

type BatchStep = Extract<GuidedStep, { kind: "batch" }>;
type BatchFixing = Extract<FixingState, { kind: "batch" }>;

/** "Fix these for me": preview, then apply at once. The step is the confirmation. */
export function startBatch(core: Core, step: BatchStep, bump: () => void): void {
  setStep(core, { kind: "working", label: STATUS.preparing });
  void (async () => {
    await core.scan.previewBatch(step.ruleIds);
    await core.scan.applyBatch();
    bump();
  })();
}

/** One status line; the dialog and the admin script are one line because Rust cannot tell them apart. */
export function batchLabel(fixing: BatchFixing): string {
  switch (fixing.phase) {
    case "confirm":
      return STATUS.preparing;
    case "waiting_for_password":
      return STATUS.password;
    case "running":
      return fixing.plan.needsPassword && fixing.item === null ? STATUS.password : STATUS.working;
    case "rechecking":
      return STATUS.checking;
    default:
      return STATUS.checking;
  }
}

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

/** Routes a rule whose item failed: a pane makes a show-me-where step, otherwise it is left alone. */
export function routeFailed(core: Core, ruleIds: readonly RuleId[]): void {
  for (const id of ruleIds) {
    const step = convertedShowStep(id);
    if (step !== null) appendSteps(core, [step]);
    else core.leftAlone.add(id);
  }
}

/** Reads the settled batch off the scan machine and sets the step's done, partial or failed state. */
export function settleBatch(core: Core, step: BatchStep, fixing: BatchFixing): void {
  core.scan.dismissFix();
  // A rejected preview or apply has no outcome; a batch that ran is read from its outcome whatever the phase.
  if (fixing.outcome === null) {
    const error = fixing.error ?? "command_failed";
    setStep(core, { kind: "failed", error, step: null, batch: true });
    return;
  }
  const { outcome, byRule } = fixing;
  const rows: DoneRow[] = [];
  const failed: RuleId[] = [];
  const ok: RuleId[] = [];
  const excluded = fixing.plan.excluded.map((e) => e.ruleId);
  for (const ruleId of step.ruleIds) {
    if (excluded.includes(ruleId)) continue;
    const verdict = byRule[ruleId];
    const item = outcome.items.find((i) => i.ruleId === ruleId);
    const strings = guidedFor(ruleId);
    if (verdict === "pass") {
      ok.push(ruleId);
      rows.push({ ruleId, ok: true, text: strings.done.replace(DONE_PREFIX, "") });
    } else if (verdict === "unreadable" && item?.status === "done") {
      ok.push(ruleId);
      rows.push({ ruleId, ok: true, text: FIX.couldNotCheck });
    } else {
      failed.push(ruleId);
      rows.push({ ruleId, ok: false, text: strings.headline, tag: paneFor(ruleId) !== null ? PLAN.showWhere : END.didNotChange });
    }
  }
  const nothingRan = outcome.items.every((i) => i.status === "not_run");
  if (ok.length === 0 && outcome.error !== null && nothingRan) {
    if (outcome.error === "command_failed") {
      core.batchFailures += 1;
      if (core.batchFailures >= 2) {
        routeFailed(core, step.ruleIds);
        advance(core);
        return;
      }
    }
    setStep(core, { kind: "failed", error: outcome.error, step: null, batch: true });
    return;
  }
  markFixed(core, ok);
  routeFailed(core, [...failed, ...excluded]);
  const line = failed.length === 0 ? `Done. ${things(ok.length)} fixed.` : `${ok.length} of ${ok.length + failed.length} fixed.`;
  setStep(core, { kind: "done", line, rows });
}
