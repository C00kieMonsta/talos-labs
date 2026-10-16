import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { SECTION_KEYS } from "@talos/core";
import type {
  BatchItemOutcome,
  BatchItemStatus,
  BatchOutcome,
  BatchPlan,
  BatchPlanItem,
  FixApplyInput,
  FixApplyOptions,
  FixChoice,
  FixError,
  FixOutcome,
  FixPlan,
  FixPlanLine,
  FixPort,
  FixProgress,
  RuleId,
  SectionKey,
} from "@talos/core";

export const FIX_ERRORS: readonly FixError[] = [
  "cancelled",
  "wrong_password",
  "command_failed",
  "timeout",
  "plan_expired",
  "precondition_changed",
  "not_in_catalog",
  "invalid_choice",
  "invalid_input",
  "busy",
];

const CHOICE_KINDS = ["none", "share", "ssh_key", "plist", "file"] as const;
const PHASES = ["waiting_for_password", "running"] as const;
const BATCH_STATUSES: readonly BatchItemStatus[] = ["done", "failed", "not_run"];
/** Longest list of rule ids sent in one batch; the catalog has 13 batchable rules. */
export const MAX_BATCH_RULES = 32;
const RULE_ID_PATTERN = /^TL-MAC-\d{3}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFixError(value: unknown): value is FixError {
  return typeof value === "string" && (FIX_ERRORS as readonly string[]).includes(value);
}

function isSectionKey(value: unknown): value is SectionKey {
  return typeof value === "string" && (SECTION_KEYS as readonly string[]).includes(value);
}

function toLine(value: unknown): FixPlanLine | null {
  if (!isRecord(value)) return null;
  const { text, privilege } = value;
  if (typeof text !== "string" || (privilege !== "user" && privilege !== "admin")) return null;
  return { text, privilege };
}

/** Every field is checked before the plan is shown; a malformed plan is a command_failed outcome, never a sheet. */
export function toFixPlan(value: unknown): FixPlan | null {
  if (!isRecord(value)) return null;
  const { planId, ruleId, lines, needsPassword, needsPassphrase, recheck, reversible, previous, expiresAt } = value;
  if (typeof planId !== "string" || planId.length === 0 || planId.length > 128) return null;
  if (typeof ruleId !== "string" || !RULE_ID_PATTERN.test(ruleId)) return null;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const parsedLines: FixPlanLine[] = [];
  for (const line of lines) {
    const parsed = toLine(line);
    if (parsed === null) return null;
    parsedLines.push(parsed);
  }
  if (typeof needsPassword !== "boolean" || typeof needsPassphrase !== "boolean") return null;
  if (!Array.isArray(recheck) || !recheck.every(isSectionKey)) return null;
  if (reversible !== null && typeof reversible !== "string") return null;
  if (previous !== null && typeof previous !== "string") return null;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) return null;
  return {
    planId,
    ruleId: ruleId as RuleId,
    lines: parsedLines,
    needsPassword,
    needsPassphrase,
    recheck: recheck as SectionKey[],
    reversible,
    previous,
    expiresAt,
  };
}

export function toFixProgress(value: unknown): FixProgress | null {
  if (!isRecord(value)) return null;
  const { planId, phase, step, of, item } = value;
  if (typeof planId !== "string") return null;
  if (typeof phase !== "string" || !(PHASES as readonly string[]).includes(phase)) return null;
  if (!Number.isInteger(step) || !Number.isInteger(of)) return null;
  const progress: FixProgress = { planId, phase: phase as FixProgress["phase"], step: step as number, of: of as number };
  // The single path sends no item; a malformed one is dropped, not the event.
  return Number.isInteger(item) ? { ...progress, item: item as number } : progress;
}

function toBatchItem(value: unknown): BatchPlanItem | null {
  if (!isRecord(value)) return null;
  const { ruleId, lines, recheck, previous } = value;
  if (typeof ruleId !== "string" || !RULE_ID_PATTERN.test(ruleId)) return null;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const parsedLines: FixPlanLine[] = [];
  for (const line of lines) {
    const parsed = toLine(line);
    if (parsed === null) return null;
    parsedLines.push(parsed);
  }
  if (!Array.isArray(recheck) || !recheck.every(isSectionKey)) return null;
  if (previous !== null && typeof previous !== "string") return null;
  return { ruleId: ruleId as RuleId, lines: parsedLines, recheck: recheck as SectionKey[], previous };
}

/** Checked like a FixPlan: every item, every excluded row, no duplicate rule across the two lists. */
export function toBatchPlan(value: unknown): BatchPlan | null {
  if (!isRecord(value)) return null;
  const { planId, items, excluded, needsPassword, recheck, expiresAt } = value;
  if (typeof planId !== "string" || planId.length === 0 || planId.length > 128) return null;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BATCH_RULES) return null;
  const parsedItems: BatchPlanItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const parsed = toBatchItem(item);
    if (parsed === null || seen.has(parsed.ruleId)) return null;
    seen.add(parsed.ruleId);
    parsedItems.push(parsed);
  }
  if (!Array.isArray(excluded)) return null;
  const parsedExcluded: { ruleId: RuleId; error: FixError }[] = [];
  for (const row of excluded) {
    if (!isRecord(row) || typeof row["ruleId"] !== "string" || !RULE_ID_PATTERN.test(row["ruleId"]) || !isFixError(row["error"])) return null;
    if (seen.has(row["ruleId"])) return null;
    seen.add(row["ruleId"]);
    parsedExcluded.push({ ruleId: row["ruleId"] as RuleId, error: row["error"] });
  }
  if (typeof needsPassword !== "boolean") return null;
  if (!Array.isArray(recheck) || !recheck.every(isSectionKey)) return null;
  if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) return null;
  return { planId, items: parsedItems, excluded: parsedExcluded, needsPassword, recheck: recheck as SectionKey[], expiresAt };
}

function failedBatch(error: FixError): BatchOutcome {
  return { ok: false, items: [], error };
}

/** Every outcome rule id must be in the plan and every status in the closed set; otherwise command_failed with no items. */
export function toBatchOutcome(value: unknown, plan: BatchPlan): BatchOutcome {
  if (!isRecord(value) || typeof value["ok"] !== "boolean" || !Array.isArray(value["items"])) return failedBatch("command_failed");
  const known = new Set<string>(plan.items.map((item) => item.ruleId));
  const items: BatchItemOutcome[] = [];
  for (const row of value["items"]) {
    if (!isRecord(row)) return failedBatch("command_failed");
    const { ruleId, status, error, step } = row;
    if (typeof ruleId !== "string" || !known.has(ruleId)) return failedBatch("command_failed");
    if (typeof status !== "string" || !(BATCH_STATUSES as readonly string[]).includes(status)) return failedBatch("command_failed");
    if (error !== null && !isFixError(error)) return failedBatch("command_failed");
    if (step !== null && !Number.isInteger(step)) return failedBatch("command_failed");
    items.push({ ruleId: ruleId as RuleId, status: status as BatchItemStatus, error: error as FixError | null, step: step as number | null });
  }
  const error = value["error"];
  if (value["ok"] === true) return { ok: true, items, error: null };
  return { ok: false, items, error: isFixError(error) ? error : "command_failed" };
}

/** A pre-run rejection of the batch carries the FixError string; anything else is command_failed. */
export function batchRejectionToOutcome(error: unknown): BatchOutcome {
  return failedBatch(isFixError(error) ? error : "command_failed");
}

/** A run-time failure resolves; a malformed answer is reported as command_failed so nothing is assumed to have run. */
export function toFixOutcome(value: unknown): FixOutcome {
  if (!isRecord(value) || typeof value["ok"] !== "boolean") return { ok: false, error: "command_failed", step: null };
  if (value["ok"] === true) return { ok: true };
  const { error, step } = value;
  return {
    ok: false,
    error: isFixError(error) ? error : "command_failed",
    step: Number.isInteger(step) ? (step as number) : null,
  };
}

/** A pre-run rejection carries the FixError string; anything else is folded into command_failed. */
export function rejectionToOutcome(error: unknown): FixOutcome {
  return { ok: false, error: isFixError(error) ? error : "command_failed", step: null };
}

function validChoice(choice: FixChoice): boolean {
  if (!(CHOICE_KINDS as readonly string[]).includes(choice.kind)) return false;
  if (choice.kind === "none") return true;
  return typeof choice.path === "string" && choice.path.length > 0 && choice.path.length <= 1024;
}

function requireChoice(ruleId: RuleId, choice: FixChoice): void {
  if (!RULE_ID_PATTERN.test(ruleId)) throw "not_in_catalog";
  if (!validChoice(choice)) throw "invalid_choice";
}

/** FixPort over the Tauri commands. Rust owns every path and every command line. */
export class TauriFixAdapter implements FixPort {
  /** Previewed batches, kept so an outcome can be checked against its plan. */
  private readonly batches = new Map<string, BatchPlan>();

  async preview(ruleId: RuleId, choice: FixChoice): Promise<FixPlan> {
    requireChoice(ruleId, choice);
    const plan = toFixPlan(await invoke<unknown>("fix_preview", { rule: ruleId, choice }));
    if (plan === null) throw "command_failed";
    return plan;
  }

  async apply(planId: string, input: FixApplyInput, options?: FixApplyOptions): Promise<FixOutcome> {
    const signal = options?.signal;
    if (signal?.aborted) return { ok: false, error: "cancelled", step: null };
    let unlisten: UnlistenFn | null = null;
    const onAbort = () => {
      void invoke("fix_cancel", { plan: planId }).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort);
    try {
      unlisten = await listen<unknown>("fix:status", (event) => {
        const progress = toFixProgress(event.payload);
        if (progress !== null && progress.planId === planId) options?.onProgress?.(progress);
      });
      const payload: { plan: string; passphrase?: string } = { plan: planId };
      if (input.passphrase !== undefined) payload.passphrase = input.passphrase;
      return toFixOutcome(await invoke<unknown>("fix_apply", payload));
    } catch (error) {
      return rejectionToOutcome(error);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unlisten?.();
    }
  }

  async previewBatch(ruleIds: readonly RuleId[]): Promise<BatchPlan> {
    if (ruleIds.length === 0 || ruleIds.length > MAX_BATCH_RULES) throw "invalid_choice";
    if (new Set(ruleIds).size !== ruleIds.length) throw "invalid_choice";
    for (const ruleId of ruleIds) if (!RULE_ID_PATTERN.test(ruleId)) throw "not_in_catalog";
    const plan = toBatchPlan(await invoke<unknown>("fix_preview_batch", { rules: ruleIds }));
    if (plan === null) throw "command_failed";
    this.batches.set(plan.planId, plan);
    return plan;
  }

  async applyBatch(planId: string, options?: FixApplyOptions): Promise<BatchOutcome> {
    const plan = this.batches.get(planId);
    if (plan === undefined) return failedBatch("plan_expired");
    const signal = options?.signal;
    if (signal?.aborted) return failedBatch("cancelled");
    let unlisten: UnlistenFn | null = null;
    const onAbort = () => {
      void invoke("fix_cancel", { plan: planId }).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort);
    try {
      unlisten = await listen<unknown>("fix:status", (event) => {
        const progress = toFixProgress(event.payload);
        if (progress !== null && progress.planId === planId) options?.onProgress?.(progress);
      });
      return toBatchOutcome(await invoke<unknown>("fix_apply_batch", { plan: planId }), plan);
    } catch (error) {
      return batchRejectionToOutcome(error);
    } finally {
      this.batches.delete(planId);
      signal?.removeEventListener("abort", onAbort);
      unlisten?.();
    }
  }

  async reveal(ruleId: RuleId, choice: FixChoice): Promise<void> {
    requireChoice(ruleId, choice);
    await invoke("fix_reveal", { rule: ruleId, choice });
  }

  async openBuyPage(): Promise<void> {
    await invoke("open_buy_page");
  }
}

export async function appRestart(): Promise<void> {
  await invoke("app_restart");
}
