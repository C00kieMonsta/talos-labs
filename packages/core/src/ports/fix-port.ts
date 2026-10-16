import type { RuleId } from "../domain/finding";
import type { SectionKey } from "../domain/system-state";
import type { AbortSignalLike } from "./system-state-port";

/**
 * What the webview sends with a rule id. A path must equal one Rust listed itself
 * at preview time; the plan binds Rust's copy, never this string.
 */
export type FixChoice =
  | { readonly kind: "none" }
  | { readonly kind: "share"; readonly path: string }
  | { readonly kind: "ssh_key"; readonly path: string }
  | { readonly kind: "plist"; readonly path: string }
  | { readonly kind: "file"; readonly path: string };

export interface FixPlanLine {
  readonly text: string;
  readonly privilege: "user" | "admin";
}

/** What fix_preview returns. What is shown here is what fix_apply runs. */
export interface FixPlan {
  readonly planId: string;
  readonly ruleId: RuleId;
  readonly lines: readonly FixPlanLine[];
  readonly needsPassword: boolean;
  readonly needsPassphrase: boolean;
  readonly recheck: readonly SectionKey[];
  readonly reversible: string | null;
  /** 013: the idle time before the fix, read at preview; null when unset or when the rule records nothing. */
  readonly previous: string | null;
  /** ISO 8601. Five minutes after preview. */
  readonly expiresAt: string;
}

export type FixPhase = "waiting_for_password" | "running";

export interface FixProgress {
  readonly planId: string;
  readonly phase: FixPhase;
  readonly step: number;
  readonly of: number;
  /** Batch only: the user-level item being run. */
  readonly item?: number;
}

/**
 * plan_expired, precondition_changed, not_in_catalog, invalid_choice, invalid_input and busy
 * are found before anything runs. cancelled, wrong_password, command_failed and timeout come from the run.
 */
export type FixError =
  | "cancelled"
  | "wrong_password"
  | "command_failed"
  | "timeout"
  | "plan_expired"
  | "precondition_changed"
  | "not_in_catalog"
  | "invalid_choice"
  | "invalid_input"
  | "busy";

export type FixOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: FixError; readonly step: number | null };

export interface FixApplyInput {
  readonly passphrase?: string;
}

export interface FixApplyOptions {
  readonly signal?: AbortSignalLike;
  readonly onProgress?: (progress: FixProgress) => void;
}

/** One rule inside a batch plan. Bound by the same preview as a single fix. */
export interface BatchPlanItem {
  readonly ruleId: RuleId;
  readonly lines: readonly FixPlanLine[];
  readonly recheck: readonly SectionKey[];
  readonly previous: string | null;
}

/** What fix_preview_batch returns. One password dialog covers every item. */
export interface BatchPlan {
  readonly planId: string;
  readonly items: readonly BatchPlanItem[];
  /** Rules dropped at preview, with the reason. */
  readonly excluded: readonly { readonly ruleId: RuleId; readonly error: FixError }[];
  readonly needsPassword: boolean;
  /** Union of every item's recheck. */
  readonly recheck: readonly SectionKey[];
  /** ISO 8601. Five minutes after preview. */
  readonly expiresAt: string;
}

export type BatchItemStatus = "done" | "failed" | "not_run";

export interface BatchItemOutcome {
  readonly ruleId: RuleId;
  readonly status: BatchItemStatus;
  readonly error: FixError | null;
  readonly step: number | null;
}

/** ok is true only when every item is done. error is the batch-level failure, or null. */
export interface BatchOutcome {
  readonly ok: boolean;
  readonly items: readonly BatchItemOutcome[];
  readonly error: FixError | null;
}

/** Implemented by the desktop app over Tauri commands. The only port that can change the Mac. */
export interface FixPort {
  preview(ruleId: RuleId, choice: FixChoice): Promise<FixPlan>;
  apply(planId: string, input: FixApplyInput, options?: FixApplyOptions): Promise<FixOutcome>;
  /** Finder reveal for 023, 024 and 031 after the same path validation as preview. */
  reveal(ruleId: RuleId, choice: FixChoice): Promise<void>;
  /** Opens the fixed shop URL chosen in Rust. */
  openBuyPage(): Promise<void>;
  /** Plans every batchable rule in the list; the rest land in excluded. */
  previewBatch(ruleIds: readonly RuleId[]): Promise<BatchPlan>;
  /** Runs a batch plan under one administrator dialog. */
  applyBatch(planId: string, options?: FixApplyOptions): Promise<BatchOutcome>;
}
