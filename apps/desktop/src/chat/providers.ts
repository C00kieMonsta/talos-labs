import type { ConnectProvider } from "../scan/ai-connect";
import type { ExplainerProvider } from "../settings";

/** The key into CHAT.stillWaiting: the API-key route waits on Claude, a local model waits on this Mac. */
export type WaitingKey = "chatgpt" | "claude_plan" | "apple";

export function waitingKey(provider: ExplainerProvider): WaitingKey {
  switch (provider) {
    case "chatgpt":
      return "chatgpt";
    case "claude_plan":
    case "claude":
      return "claude_plan";
    case "apple":
    case "ollama":
      return "apple";
  }
}

/** The provider named in a state line; the API-key route reads as Claude, everything else as ChatGPT. */
export function remoteOf(provider: ExplainerProvider): ConnectProvider {
  return provider === "claude_plan" || provider === "claude" ? "claude_plan" : "chatgpt";
}
