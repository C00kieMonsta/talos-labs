import { ACTIVITY, CHAT } from "../guided/copy";
import type { ChatMessage, ChatState, ChipId } from "./state";

/** The chip table of docs/DESIGN-CHAT.md "Chips": at most four, each at most 25 characters, every one zero calls but "Why?". */

export const MAX_CHIPS = 4;
export const MAX_CHIP_CHARS = 25;

export interface Chip {
  readonly id: ChipId;
  readonly label: string;
}

/** What the plan says, read by the hook from the bridge; chips never name an accepted or snoozed item because they name none. */
export interface ChipFacts {
  /** An undone fix or batch step exists: "Fix what you can" applies. */
  readonly fixable: boolean;
  /** Any undone step: "Do them all" and "What's next?" apply. */
  readonly anyUndone: boolean;
  /** An undone step is critical or high: "What is urgent?" rather than "What should I do first?". */
  readonly urgentOrHigh: boolean;
  /** The opening already shows the urgent card, so the chip would repeat it. */
  readonly urgentLive: boolean;
  /** The newest card was derived on this Mac: "Leave it alone" leads. */
  readonly onDeviceCard: boolean;
  /** The newest card names one rule: "Why?" has a headline to ask about. */
  readonly ruleCard: boolean;
}

/** AGENT part B (2j): the chip row's slots after "Do this later" and after a what-if answer are read off the messages. */

const LABELS: Readonly<Record<ChipId, string>> = {
  do_them_all: CHAT.chips.doThemAll,
  fix_what_you_can: CHAT.chips.fixWhatYouCan,
  what_is_urgent: CHAT.chips.whatIsUrgent,
  what_first: CHAT.chips.whatFirst,
  whats_next: CHAT.chips.whatsNext,
  show_list: CHAT.chips.showList,
  check_again: CHAT.chips.checkAgain,
  leave_alone: CHAT.chips.leaveAlone,
  why: CHAT.chips.why,
  try_again: CHAT.tryAgain,
  send_again: CHAT.sendAgain,
  remind_tomorrow: ACTIVITY.chips.remindTomorrow,
  remind_sunday: ACTIVITY.chips.remindSunday,
  what_if: ACTIVITY.chips.whatIf,
  write_up: ACTIVITY.chips.writeUp,
};

export function chipLabel(id: ChipId): string {
  return LABELS[id];
}

type Context = "opening" | "result" | "offer" | "end" | "nothing" | "later" | "what_if";

/** A card the person just declined: resolved as snoozed and naming one rule. */
function declined(m: ChatMessage): boolean {
  return m.kind === "card" && m.state === "resolved" && m.outcome === "snoozed" && m.card.ruleId !== null;
}

/** What the newest message says about where the conversation is. */
function contextOf(messages: readonly ChatMessage[]): Context {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m === undefined) continue;
    switch (m.kind) {
      case "card": {
        if (m.card.kind === "lock") return "result";
        if (m.card.kind === "watch") return m.state === "idle" ? "offer" : "result";
        if (declined(m)) return "later";
        if (m.state !== "idle" && m.state !== "working" && m.state !== "failed") return "result";
        const earlier = messages.slice(0, i);
        if (earlier.every((p) => p.kind !== "person" && !(p.kind === "app" && p.label !== "opening"))) return "opening";
        // A card promoted after a result (the row that came with it) keeps the result's chips, not an offer's.
        const before = [...earlier].reverse().find((p) => p.kind !== "row" && p.kind !== "notice");
        if (before !== undefined && declined(before)) return "later";
        if (before?.kind === "app" && before.label === "what_if") return "what_if";
        return before?.kind === "card" && before.state === "resolved" ? "result" : "offer";
      }
      case "app":
        if (m.label === "end") return "end";
        if (m.label === "opening") return "opening";
        if (m.label === "result") return "result";
        if (m.label === "what_if") return "what_if";
        return "offer";
      case "model":
        return "offer";
      case "person":
        return "result";
      case "row":
      case "notice":
        continue;
    }
  }
  return "nothing";
}

/** The chips for the state; empty while a turn streams. */
export function chipsFor(state: ChatState, facts: ChipFacts): readonly Chip[] {
  // No chip while a turn streams or a card works: nothing may start a second request or a second card.
  if (state.stream.kind !== "idle" || state.working !== null) return [];
  const disabled = state.composer.kind === "limit" || state.composer.kind === "signed_out";
  const ids: ChipId[] = [];
  const next = () => {
    if (facts.anyUndone) ids.push("whats_next");
  };
  switch (contextOf(state.messages)) {
    case "opening":
      if (!facts.anyUndone) {
        ids.push("show_list", "check_again");
        break;
      }
      // DESIGN-AGENT 2j: Do them all, Fix what you can, What is urgent? (or the list while the urgent card is live), Write this up.
      ids.push("do_them_all");
      if (facts.fixable) ids.push("fix_what_you_can");
      if (facts.urgentOrHigh && !facts.urgentLive) ids.push("what_is_urgent");
      else if (!facts.urgentOrHigh) ids.push("what_first");
      else ids.push("show_list");
      ids.push("write_up");
      if (!ids.includes("show_list")) ids.push("show_list");
      break;
    case "later":
      ids.push("remind_tomorrow", "what_if");
      next();
      ids.push("show_list");
      break;
    case "what_if":
      // The what-if was answered: Leave it alone sits beside the answer and the chip is not repeated.
      ids.push("leave_alone");
      next();
      ids.push("show_list");
      break;
    case "result":
      next();
      ids.push("show_list", "check_again");
      break;
    case "offer":
      if (facts.onDeviceCard) ids.push("leave_alone", "what_if");
      else if (facts.ruleCard) ids.push("why");
      next();
      ids.push("show_list");
      break;
    case "end":
      ids.push("write_up", "show_list", "check_again");
      break;
    case "nothing":
      ids.push("show_list", "check_again");
      break;
  }
  return ids
    .filter((id) => !(disabled && id === "why"))
    .slice(0, MAX_CHIPS)
    .map((id) => ({ id, label: LABELS[id] }));
}
