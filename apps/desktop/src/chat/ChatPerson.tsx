import { CHAT } from "../guided/copy";
import type { ChatMessage } from "./state";

type Person = Extract<ChatMessage, { kind: "person" }>;

/** The person's turn: a right-hand bubble of text nodes; "Stopped." and "Send again" under it when a turn was stopped. */
export function ChatPerson({ message, onResend }: { message: Person; onResend(text: string): void }) {
  return (
    <div className="chat-person-turn">
      <div className="chat-person">{message.text}</div>
      {message.stopped && <p className="chat-meta chat-person-meta">{CHAT.stopped}</p>}
      {message.resend && (
        <div className="chat-chips chat-chips-inline">
          <button type="button" className="chat-chip" onClick={() => onResend(message.text)}>
            {CHAT.sendAgain}
          </button>
        </div>
      )}
    </div>
  );
}
