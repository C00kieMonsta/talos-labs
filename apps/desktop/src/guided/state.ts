import type { Capabilities, ChatOutcome, FixError, GuidedMemory, GuidedPlan, GuidedStep, NextAction, RemindWhen, ReportDiff, RuleId, ScanReport, SectionKey, SettingsPane } from "@talos/core";
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
  | { readonly kind: "end"; readonly plan: GuidedPlan; readonly fixed: readonly RuleId[] }
  /**
   * The chat home (DESIGN-CHAT section 2). `active` is the live card's step while it runs; `diff` carries the
   * "since last time" rows into the opening; `resumed` is true once after a guided relaunch, so the chat appends
   * the first undone step's card. Card states are read off the scan machine through GuidedController.chat.
   */
  | { readonly kind: "chat"; readonly plan: GuidedPlan; readonly diff: ReportDiff | null; readonly active: GuidedStep | null; readonly walking: boolean; readonly resumed: boolean; readonly reminders: readonly RuleId[] };

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
  | { readonly kind: "later_flash"; readonly text?: string }
  /** The third "Do this later": "Shall I stop asking about this?" for the rules whose count reached LATER_ASK_COUNT. */
  | { readonly kind: "ask_accept"; readonly ruleIds: readonly RuleId[] };

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
  /** "Do this next" on the end screen: reopen the action's step as the last step and run it. */
  doNext(action: NextAction): void;
  /** Unlock in the Explain disclosure: open the paywall step before the current one, so leaving it returns here. */
  goToPaywall(): void;
  /** "No, keep asking" on the ask screen: the count goes back to 0 and the snooze stands. */
  keepAsking(): void;
  /** "Leave it alone, I know the risk": the asked rules are accepted and never a step again. */
  accept(): void;
  /** The chat's way into the step machinery; every member is a no-op outside the chat phase unless it says otherwise. */
  readonly chat: ChatBridge;
}

/** How a chat card settled: `expired` is a show card whose watcher timed out, everything else is the step's own done or failed state. */
export type ChatSettledState = Extract<StepState, { kind: "done" | "failed" }> | { readonly kind: "expired" };

export interface ChatSettled {
  readonly step: GuidedStep;
  readonly outcome: ChatOutcome;
  readonly state: ChatSettledState;
}

/**
 * The chat's bridge into Core (DESIGN-CHAT section 7, "How cards enter the step machinery"). A card is the
 * guided step: `run` starts it exactly as the step's primary would, the scan machine carries its progress,
 * and `settle` or `observeShow` reads the outcome back. The chat reads `scan.fixing` and `scan.watching`
 * for the working state; nothing here is a React state beyond the phase.
 */
export interface ChatBridge {
  /** The plan the chat draws from; null outside the chat phase. */
  readonly plan: GuidedPlan | null;
  /** The launch diff for the opening's "since last time" rows; null when nothing changed or outside the chat phase. */
  readonly diff: ReportDiff | null;
  /** True once after a guided relaunch (talos.continue): the opening appends the first undone step's card. */
  readonly resumed: boolean;
  /** The live card's step while it runs; null when no card is in flight. */
  readonly active: GuidedStep | null;
  /** "Do them all" is walking the plan. */
  readonly walking: boolean;
  /** Rules fixed this check-up, for the end message. */
  readonly fixed: readonly RuleId[];
  /** Rules the person moved past without a fix this check-up. */
  readonly leftAlone: readonly RuleId[];
  /** Step ids settled this check-up (fixed, passing, snoozed, accepted, left alone, a granted permission, a snoozed paywall): buildAllowed's doneStepIds. */
  readonly doneStepIds: readonly string[];
  /** The Full Disk Access flow's card, for a permission card. */
  readonly permission: PermissionCardState;
  /** The plan's steps not yet settled, in plan order. */
  undone(): readonly GuidedStep[];
  nextUndone(): GuidedStep | null;
  /** True when no undone step remains: the chat appends the end message. */
  atEnd(): boolean;
  /** The plan with the latest memory folded in (finalPlan), for the end message's title and rows; null outside the chat phase. */
  endPlan(): GuidedPlan | null;
  /**
   * Makes `step` the live card (appending it to the plan when it is not there, as "Do this next" does) and runs
   * it as the step's primary would: fix and batch preview then apply, show opens the pane and watches, permission
   * writes the continue note and opens the pane. A 029 step passes the typed passphrase. A paywall step does nothing.
   */
  run(step: GuidedStep, passphrase?: string): void;
  /** "Check again" on a still-failing fix card or a stale show card: one free recheck, then the outcome, or null while the show card keeps watching. */
  checkAgain(step: GuidedStep): Promise<ChatSettled | null>;
  /** Reads the settled fix, batch or granted permission off the scan machine for the active card; null while it is still in flight. Clears `active`. */
  settle(): ChatSettled | null;
  /** The active show card's watcher: passed or expired, or null while it still watches. Clears `active` on an outcome. */
  observeShow(): ChatSettled | null;
  /** When the active show card started watching, for the stale line; null when nothing watches. */
  watchingSince(): string | null;
  /** "Do this later": a 7 day snooze (14 for the paywall, the asked-at note for a permission); returns the rules whose third Later asks about accepting. */
  later(step: GuidedStep): readonly RuleId[];
  /** "Ask me again tomorrow" and "Remind me on Sunday" (DESIGN-AGENT 2f): snoozed and reminders to 09:00 that day; laterCount untouched. */
  remind(step: GuidedStep, when: RemindWhen): void;
  /** The same reminder for a rule with no step this check-up (a later id): the two dates, nothing else. */
  remindRules(ruleIds: readonly RuleId[], when: RemindWhen): void;
  /** The due reminder ids landed() found for this check-up, for the opening's lead line. */
  readonly reminders: readonly RuleId[];
  /** "Leave it alone, I know the risk": accepted until "Ask me again". */
  accept(ruleIds: readonly RuleId[]): void;
  /** The 026 question's "No, I'll get one later": a 30 day snooze. */
  answerNo(step: GuidedStep): void;
  /** "Next" on a failed card: the rules are left alone this check-up. */
  leaveAlone(step: GuidedStep): void;
  /** The paywall card's "Not now": 14 days, and the card is gone. */
  snoozePaywall(): void;
  /** After the licence field verified a key: plans the locked rules, appends them, returns them. */
  unlock(): readonly GuidedStep[];
  setWalking(walking: boolean): void;
  /** "Step by step": the walk-through at the first undone step; settled steps go first so the progress line is right. */
  stepByStep(): void;
  /**
   * AI off, Disconnect, not_offered, plan_not_eligible: the plan or end screen on the same plan. A card in flight
   * opens as its step in the working or watching state instead, so Core settles it there (DESIGN-CHAT section 2).
   */
  leaveChat(): void;
  /** The "Chat" strip link and the expert sidebar: the chat phase on the current plan. A no-op while a step is in flight or there is no plan. */
  toChat(): void;
  /** "Check again" from the chat: a fresh check-up; landed() decides the home again. */
  rescan(): void;
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
