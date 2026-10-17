import { createContext } from "react";

/** A question handed in by the watch window (watch:open { screen: "chat", question }); `seq` makes a repeat distinct. */
export interface ChatDraft {
  readonly text: string;
  readonly seq: number;
}

/** App provides the latest draft; the chat consumes it as draft_received. Null when none arrived. */
export const ChatDraftContext = createContext<ChatDraft | null>(null);
