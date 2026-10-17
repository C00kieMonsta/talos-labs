import { createContext } from "react";

/** A question handed in by the watch window (watch:open { screen: "chat", question }); `seq` makes a repeat distinct. */
export interface ChatDraft {
  readonly text: string;
  readonly seq: number;
}

export interface ChatDraftSlot {
  /** The latest draft; null when none arrived or the chat took it. */
  readonly draft: ChatDraft | null;
  /** The chat took draft `seq`: App drops it so a remount does not replay it. */
  consume(seq: number): void;
}

/** App provides the latest draft; the chat consumes it once as draft_received. */
export const ChatDraftContext = createContext<ChatDraftSlot>({ draft: null, consume: () => undefined });
