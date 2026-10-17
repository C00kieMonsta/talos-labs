import { aiBadge } from "../app/labels";
import { ModelText } from "../components/ModelText";
import { CHAT } from "../guided/copy";
import { waitingKey } from "./providers";
import type { ChatMessage } from "./state";

type Model = Extract<ChatMessage, { kind: "model" }>;

/** The model's voice: a rule-left block, the caret while streaming, the badge from the first partial, never a control. */
export function ChatModel({ message }: { message: Model }) {
  return (
    <div className="guided-model" aria-live={message.streaming ? "off" : undefined}>
      <ModelText text={message.text} caret={message.streaming} />
      <p className="chat-badge">{aiBadge(message.provider)}</p>
      {message.stillWaiting && <p className="chat-meta">{CHAT.stillWaiting[waitingKey(message.provider)]}</p>}
      {!message.streaming && message.outsideScope && <p className="chat-notice">{CHAT.outside}</p>}
    </div>
  );
}
