import { invoke } from "@tauri-apps/api/core";
import type { Assistant } from "../settings";

/** Rust maps the assistant id to a fixed URL and percent-encodes the prompt; the webview never passes a URL. */
export async function openAssistant(assistant: Assistant, prompt: string): Promise<void> {
  await invoke("open_assistant", { assistant, prompt });
}
