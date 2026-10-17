import { CHAT } from "../guided/copy";
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
}

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
};

export function chipLabel(id: ChipId): string {
  return LABELS[id];
}

type Context = "opening" | "result" | "offer" | "end" | "nothing";

/** What the newest message says about where the conversation is. */
function contextOf(messages: readonly ChatMessage[]): Context {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m === undefined) continue;
    switch (m.kind) {
      case "card":
        if (m.card.kind === "watch" || m.card.kind === "lock") return m.state === "idle" ? "offer" : "result";
        if (m.state === "idle" || m.state === "working" || m.state === "failed") return messages.slice(0, i).every((p) => p.kind !== "person" && !(p.kind === "app" && p.label !== "opening")) ? "opening" : "offer";
        return "result";
      case "app":
        if (m.label === "end") return "end";
        if (m.label === "opening") return "opening";
        if (m.label === "result") return "result";
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
      ids.push("do_them_all");
      if (facts.fixable) ids.push("fix_what_you_can");
      if (facts.urgentOrHigh && !facts.urgentLive) ids.push("what_is_urgent");
      else if (!facts.urgentOrHigh) ids.push("what_first");
      ids.push("show_list");
      break;
    case "result":
      next();
      ids.push("show_list", "check_again");
      break;
    case "offer":
      ids.push(facts.onDeviceCard ? "leave_alone" : "why");
      next();
      ids.push("show_list");
      break;
    case "end":
    case "nothing":
      ids.push("show_list", "check_again");
      break;
  }
  return ids
    .filter((id) => !(disabled && id === "why"))
    .slice(0, MAX_CHIPS)
    .map((id) => ({ id, label: LABELS[id] }));
}
