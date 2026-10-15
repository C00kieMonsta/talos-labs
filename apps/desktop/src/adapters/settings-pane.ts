import { invoke } from "@tauri-apps/api/core";
import type { SettingsPane } from "@talos/core";

/** Rust maps the pane name to a System Settings URL; the webview never passes a URL. */
export async function openSettingsPane(pane: SettingsPane): Promise<void> {
  await invoke("open_settings_pane", { pane });
}
