import { ICONS } from "../app/icons";
import { Icon } from "../components/Icon";
import type { ChatMessage } from "./state";

type Row = Extract<ChatMessage, { kind: "row" }>;

/** A demoted or listed item: one 44 px row that makes its step the live card. */
export function ChatRow({ message, onPromote }: { message: Row; onPromote(rowId: string): void }) {
  return (
    <button type="button" className="guided-end-row chat-row" onClick={() => onPromote(message.id)}>
      <Icon icon={ICONS.steps} size={20} className="guided-end-row-icon" />
      <span className="guided-end-row-text">{message.headline}</span>
      <Icon icon={ICONS.chevronRight} size={16} className="guided-end-row-chevron" />
    </button>
  );
}
