import type { RuleId } from "../domain/finding";
import type { ExplainerContext, Turn } from "../ports/explainer-port";
import type { Change, FishyKind, Rating, SignalId } from "../ports/watch-port";
import type { ChatIntent, IntentKind } from "./intents";
export { CHAT_LIMITS, clampChatHistory } from "../explainer/limits";

/** The six outcomes the model may hear about. */
export type ChatEvent = "fixed" | "did_not_change" | "snoozed" | "accepted" | "pane_opened" | "rescanned";
export const CHAT_EVENTS: readonly ChatEvent[] = ["fixed", "did_not_change", "snoozed", "accepted", "pane_opened", "rescanned"];

/** Every app-side outcome; only ChatEvent members ever leave the Mac. */
export type ChatOutcome =
  | ChatEvent
  | "could_not_check"
  | "checked"
  | "cancelled"
  | "wrong_password"
  | "timeout"
  | "watch_passed"
  | "watch_expired"
  | "unlocked"
  | "stale"
  | "stopped";

/** The serialised allow-lists. `accepted` and `snoozed` of Allowed are validator-only and never here. */
export interface AllowedInput {
  readonly fix: readonly RuleId[];
  readonly batch: readonly RuleId[];
  readonly show: readonly RuleId[];
  readonly explain: readonly RuleId[];
  readonly details: readonly RuleId[];
  readonly snooze: readonly RuleId[];
  readonly accept: readonly RuleId[];
  /** The live watch items' ids; empty until WATCH_AGENT_PORTS_READY and while the watch is not active. */
  readonly investigate: readonly SignalId[];
  /** The undone and later step ids a reminder may name. */
  readonly remind: readonly RuleId[];
  /** Every failing rule id. */
  readonly whatIf: readonly RuleId[];
  readonly kinds: readonly IntentKind[];
}

export interface ChatPlanInput {
  /** One id per undone batch, fix or show step (the first rule of a batch), at most CHAT_LIMITS.maxPlanIds. */
  readonly stepRuleIds: readonly RuleId[];
  readonly fixed: readonly RuleId[];
  readonly later: readonly RuleId[];
  readonly accepted: readonly RuleId[];
  readonly leftAlone: readonly RuleId[];
}

export interface ChatEventInput {
  readonly kind: ChatEvent;
  readonly ruleIds: readonly RuleId[];
  readonly turnsAgo: number;
}

export interface ChatWatchInput {
  readonly enabled: boolean;
  readonly rating: Rating;
  readonly lastCheckMinutesAgo: number | null;
  /** At most CHAT_LIMITS.maxWatchItems; ids and enums only, never WatchDetails. */
  readonly items: readonly { readonly signalId: SignalId; readonly kind: FishyKind; readonly change: Change }[];
}

/** What one turn sends. Every value is an id under SAFE_STRING_PATTERN, a closed enum, a boolean or a finite number, except question and history. */
export interface ChatInput {
  readonly context: ExplainerContext;
  /** Already clamped by clampChatHistory; assistant turns are validated reply text only. */
  readonly history: readonly Turn[];
  /** Already clamped at CHAT_LIMITS.maxQuestionChars. */
  readonly question: string;
  readonly plan: ChatPlanInput;
  readonly allowed: AllowedInput;
  /** At most CHAT_LIMITS.maxEvents, newest first. */
  readonly events: readonly ChatEventInput[];
  readonly watch: ChatWatchInput;
}

/** The validated answer. `locked` is app-side: ids the model pointed at that the licence does not cover. */
export interface ChatResult {
  readonly reply: string;
  readonly relatedRuleIds: readonly RuleId[];
  readonly outsideScope: boolean;
  /** At most CHAT_LIMITS.maxIntents, every id already checked against Allowed. Empty on the on-device and plainOutput paths. */
  readonly intents: readonly ChatIntent[];
  readonly locked: readonly RuleId[];
}
