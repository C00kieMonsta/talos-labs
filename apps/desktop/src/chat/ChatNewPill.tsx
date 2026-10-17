import { CHAT } from "../guided/copy";

/** "New messages" above the foot while the person is scrolled up and something landed. */
export function ChatNewPill({ onClick }: { onClick(): void }) {
  return (
    <button type="button" className="chat-new-pill" onClick={onClick}>
      {CHAT.newMessages} <span aria-hidden="true">↓</span>
    </button>
  );
}
