import { createContext } from "react";

/** A question handed to the chat by the watch window (DESIGN-WATCH-WINDOW "Commands": watch:open { screen: "chat", question }). */
export interface ChatDraft {
  readonly text: string;
  /** Date.now() when it arrived, so a stale draft is told from a repeat. */
  readonly at: number;
}

export interface ChatDraftChannel {
  /** The draft waiting for the chat, or null. App.tsx holds it until the chat is on screen, so one arriving before the launch check-up lands is kept. */
  readonly draft: ChatDraft | null;
  /** The chat took the draft into its field (draft_received); nothing is sent here, the chat decides autoSend itself. */
  clear(): void;
}

/** Read by the chat's useChat; App.tsx provides it around the guided shell. */
export const ChatDraftContext = createContext<ChatDraftChannel>({ draft: null, clear: () => undefined });
