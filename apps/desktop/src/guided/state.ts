import type { Capabilities, FixError, GuidedMemory, GuidedPlan, ReportDiff, RuleId, ScanReport, SectionKey, SettingsPane } from "@talos/core";
import type { Gate } from "../app/gate";
import type { ScanError } from "../scan/machine";
import type { PermissionCardState, PermissionKind } from "../scan/useCapabilityPoll";
import type { AppSettings } from "../settings";

export type GuidedPhase =
  | { readonly kind: "welcome" }
  | { readonly kind: "scanning" }
  /** `cancelled` is true after a cancelled check-up; false when the guide is waiting with the automatic check-up off. */
  | { readonly kind: "stopped"; readonly cancelled?: boolean }
  | { readonly kind: "failed"; readonly error: ScanError }
  | { readonly kind: "since"; readonly diff: ReportDiff; readonly plan: GuidedPlan }
  /** `same` is true when a previous report exists and nothing changed. */
  | { readonly kind: "plan"; readonly plan: GuidedPlan; readonly listOpen: boolean; readonly same: boolean }
  | { readonly kind: "step"; readonly plan: GuidedPlan; readonly index: number; readonly state: StepState; readonly notice: string | null }
  | { readonly kind: "end"; readonly plan: GuidedPlan; readonly fixed: readonly RuleId[] };

export interface DoneRow {
  readonly ruleId: RuleId;
  readonly ok: boolean;
  readonly text: string;
  /** A line under the text on a failed row: "I'll show you where" or "Did not change". */
  readonly tag?: string;
}

export type StepState =
  | { readonly kind: "idle" }
  | { readonly kind: "question" }
  | { readonly kind: "working"; readonly label: string }
  | { readonly kind: "watching"; readonly since: string; readonly stale: boolean }
  | { readonly kind: "permission"; readonly card: PermissionCardState }
  | { readonly kind: "done"; readonly line: string; readonly rows: readonly DoneRow[] }
  | { readonly kind: "failed"; readonly error: FixError | "still_failing" | "unreadable"; readonly step: number | null; readonly batch: boolean }
  /** `text` overrides the usual "OK, I'll remind you another day." (the backup question, the paywall thank-you). */
  | { readonly kind: "later_flash"; readonly text?: string };

export interface GuidedController {
  readonly phase: GuidedPhase;
  /** done is the index of the current step; of is the plan length, which only grows. */
  readonly progress: { readonly done: number; readonly of: number };
  start(): void;
  carryOn(): void;
  /** The one button of the current step. A 029 step passes the typed passphrase. */
  primary(passphrase?: string): void;
  later(): void;
  next(): void;
  answer(question: "backup_disk", yes: boolean): void;
  toggleList(): void;
  /** The paywall's licence field verified the key itself; this carries on and plans the unlocked rules. */
  enterLicence(key: string): Promise<void>;
}

export interface GuidedDeps {
  readonly gate: Gate;
  readonly settings: AppSettings;
  readonly memory: GuidedMemory;
  saveMemory(memory: GuidedMemory): void;
  /** The latest Capabilities App.tsx holds, for initialPermissionState. */
  readonly capabilitiesNow: Capabilities | null;
  capabilities(): Promise<Capabilities>;
  openPane(pane: SettingsPane | PermissionKind): Promise<void>;
  /** Forwarded to usePermissionFlow; unused for full_disk_access. */
  collectSection(key: SectionKey): Promise<unknown>;
  restart(): Promise<void>;
  readonly reducedMotion: boolean;
  readonly windowFocused: boolean;
  /** True when the launch read a `{ kind: "guided" }` continue note: the plan and since screens are skipped. */
  readonly resume?: boolean;
  /** The report loadLast returned, for the "since last time" diff; the launch scan drops it from the machine. */
  loadedReport?(): ScanReport | null;
}

/** True while a batch, a fix or a watcher is in flight on the current step. */
export function stepBusy(phase: GuidedPhase): boolean {
  if (phase.kind !== "step") return false;
  const s = phase.state.kind;
  return s === "working" || s === "watching";
}

/** The progress line of a step reads "1 of 5" on the first step; the bar fills to the step shown, like the kit. */
export function stepProgress(controller: GuidedController): { done: number; of: number } {
  const { done, of } = controller.progress;
  return { done: Math.min(done + 1, of), of };
}
