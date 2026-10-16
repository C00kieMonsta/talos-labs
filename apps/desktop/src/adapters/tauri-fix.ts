import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { SECTION_KEYS } from "@talos/core";
import type {
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
  const { planId, phase, step, of } = value;
  if (typeof planId !== "string") return null;
  if (typeof phase !== "string" || !(PHASES as readonly string[]).includes(phase)) return null;
  if (!Number.isInteger(step) || !Number.isInteger(of)) return null;
  return { planId, phase: phase as FixProgress["phase"], step: step as number, of: of as number };
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
