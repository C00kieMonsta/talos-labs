import type { RuleId, Severity } from "../domain/finding";
import type { Turn } from "../ports/explainer-port";
import type { ChatIntent, IntentKind } from "./intents";

export type ChatCardKind =
  | "fix"
  | "batch"
  | "show"
  | "permission"
  | "accept"
  | "snooze"
  | "lock"
  | "rescan"
  | "details"
  | "explain"
  | "change_ai"
  | "watch"
  | "question"
  | "write_up";

export interface ChatCard {
  readonly kind: ChatCardKind;
  readonly ruleId: RuleId | null;
  /** The batch's ids, the lock card's locked ids; [ruleId] otherwise; [] for rescan, change_ai, watch. */
  readonly ruleIds: readonly RuleId[];
  readonly severity: Severity | null;
}

const CARD_KIND_FOR: Readonly<Record<IntentKind, ChatCardKind | null>> = {
  fix_rule: "fix",
  fix_batch: "batch",
  show_where: "show",
  explain_rule: "explain",
  open_details: "details",
  show_list: null,
  rescan: "rescan",
  change_ai: "change_ai",
  snooze_rule: "snooze",
  accept_rule: "accept",
  open_watch: "watch",
  investigate: null,
  close_watch: null,
  remind_rule: null,
  write_up: "write_up",
  what_if: null,
};

/** null for show_list and the four app-message kinds; the desktop resolves what_if to the rule's own step card. */
export function cardKindFor(kind: IntentKind): ChatCardKind | null {
  return CARD_KIND_FOR[kind];
}

/** The minimal message shape core reads; the desktop's ChatMessage satisfies it structurally. */
export interface HistoryMessage {
  readonly kind: "app" | "person" | "model" | "card" | "row" | "notice";
  readonly text?: string;
  readonly source?: "typed" | "chip";
  readonly streaming?: boolean;
}

/** Typed person texts and finished model texts, in order; never app, card, row, notice, a streaming block or a chip echo. */
export function historyFor(messages: readonly HistoryMessage[]): readonly Turn[] {
  const out: Turn[] = [];
  for (const message of messages) {
    if (typeof message.text !== "string" || message.text.length === 0) continue;
    if (message.kind === "person" && message.source === "typed") {
      out.push({ role: "user", text: message.text });
    } else if (message.kind === "model" && message.streaming !== true) {
      out.push({ role: "assistant", text: message.text });
    }
  }
  return out;
}

export const EXCHANGE_LABEL_CHARS = 60;

/** "You asked" + the text clipped to 60 characters with newlines collapsed; "Talos Labs" for null. Strings passed in so core holds no copy. */
export function exchangeLabel(person: string | null, strings: { readonly you: string; readonly app: string }): string {
  if (person === null) return strings.app;
  const flat = person.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const clipped = flat.length > EXCHANGE_LABEL_CHARS ? flat.slice(0, EXCHANGE_LABEL_CHARS) : flat;
  return `${strings.you} ${clipped}`;
}

/** Ten minutes: a divider is drawn between two messages further apart than this. */
export const DIVIDER_GAP_MS = 600_000;

export function dividerBefore(prevAt: number, nextAt: number): boolean {
  return nextAt - prevAt > DIVIDER_GAP_MS;
}

/** The card an intent draws, or null for show_list. ruleIds defaults to [ruleId] or []; the batch passes its own ids. */
export function intentToCard(intent: ChatIntent, severity: Severity | null, ruleIds?: readonly RuleId[]): ChatCard | null {
  const kind = cardKindFor(intent.kind);
  if (kind === null) return null;
  return {
    kind,
    ruleId: intent.ruleId,
    ruleIds: ruleIds ?? (intent.ruleId === null ? [] : [intent.ruleId]),
    severity,
  };
}
