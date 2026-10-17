import type { RuleId } from "../domain/finding";
import type { SignalId } from "../ports/watch-port";

/** DESIGN-CHAT section 4's eleven, then DESIGN-AGENT part B's five, in that order. */
export const INTENT_KINDS = [
  "fix_rule",
  "fix_batch",
  "show_where",
  "explain_rule",
  "open_details",
  "show_list",
  "rescan",
  "change_ai",
  "snooze_rule",
  "accept_rule",
  "open_watch",
  "investigate",
  "close_watch",
  "remind_rule",
  "write_up",
  "what_if",
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

/** The two days a reminder may name. */
export const REMIND_WHENS = ["tomorrow", "sunday"] as const;
export type RemindWhen = (typeof REMIND_WHENS)[number];

/** Kinds that take no ruleId; a ruleId on them is ignored by the validator. investigate takes a signalId or a ruleId and is handled on its own. */
export const INTENT_KINDS_WITHOUT_RULE: readonly IntentKind[] = ["fix_batch", "show_list", "rescan", "change_ai", "open_watch", "close_watch", "write_up"];

export interface ChatIntent {
  readonly kind: IntentKind;
  /** null for the kinds above; a report rule id otherwise. */
  readonly ruleId: RuleId | null;
  /** investigate on a watch item; the validator emits null on every other kind. */
  readonly signalId?: SignalId | null;
  /** remind_rule only; the validator emits null on every other kind. */
  readonly when?: RemindWhen | null;
}
