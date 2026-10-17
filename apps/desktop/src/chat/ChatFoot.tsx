import { CHAT } from "../guided/copy";
import { ChatChips } from "./ChatChips";
import { ChatComposer } from "./ChatComposer";
import type { ChatComposerProps } from "./ChatComposer";
import { ChatNewPill } from "./ChatNewPill";
import type { Chip } from "./chips";
import type { ChipId } from "./state";

export interface ChatFootProps extends ChatComposerProps {
  readonly chips: readonly Chip[];
  onChip(id: ChipId): void;
  readonly pill: boolean;
  onPill(): void;
  /** Developer mode: the call counter under the form; null hides it. */
  readonly calls: number | null;
}

/** Sticky at the bottom of the column: the pill above it, the chips, the composer, the Developer calls line. */
export function ChatFoot(props: ChatFootProps) {
  const { chips, onChip, pill, onPill, calls, ...composer } = props;
  return (
    <div className="chat-foot">
      {pill && <ChatNewPill onClick={onPill} />}
      <ChatChips chips={chips} onChip={onChip} />
      <ChatComposer {...composer} />
      {calls !== null && <p className="chat-meta chat-calls">{CHAT.calls.replace("{n}", String(calls))}</p>}
    </div>
  );
}
