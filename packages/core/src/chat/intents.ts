import type { RuleId } from "../domain/finding";

/** DESIGN-CHAT section 4. AGENT part B appends its five kinds here later; nothing else changes. */
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
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

/** Kinds that take no ruleId; a ruleId on them is ignored by the validator. */
export const INTENT_KINDS_WITHOUT_RULE: readonly IntentKind[] = ["fix_batch", "show_list", "rescan", "change_ai", "open_watch"];

export interface ChatIntent {
  readonly kind: IntentKind;
  /** null for the five kinds above; a report rule id otherwise. */
  readonly ruleId: RuleId | null;
}
