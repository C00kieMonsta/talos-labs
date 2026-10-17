import type { Route } from "../app/router";
import type { ChatMessage, ChipId } from "./state";

type Notice = Extract<ChatMessage, { kind: "notice" }>;

/** One authored sentence with at most one way out: a chip or a text link. */
export function ChatNotice({ message, onChip, onNavigate }: { message: Notice; onChip(id: ChipId): void; onNavigate(route: Route): void }) {
  const { wayOut } = message;
  return (
    <div className="chat-notice-block">
      <p className="chat-notice">{message.text}</p>
      {wayOut?.kind === "chip" && (
        <div className="chat-chips chat-chips-inline">
          <button type="button" className="chat-chip" onClick={() => onChip(wayOut.action)}>
            {wayOut.label}
          </button>
        </div>
      )}
      {wayOut?.kind === "link" && (
        <button type="button" className="guided-link" onClick={() => onNavigate(wayOut.route)}>
          {wayOut.label}
        </button>
      )}
    </div>
  );
}
