import { aiAskedRecently, parseGuidedMemory } from "@talos/core";
import { parseSettings, SETTINGS_STORAGE_KEY } from "../settings";

/** Mirrors guided/memory.ts GUIDED_STORAGE_KEY; the key is fixed by DESIGN-V03.md section 7. */
const GUIDED_STORAGE_KEY = "talos.guided";

/**
 * Whether the calm window may draw its one Connect line (docs/DESIGN-WATCH-WINDOW.md, "AI not
 * connected"): the AI switch is on, a provider that signs in is chosen (ChatGPT or Claude; On
 * this Mac never connects and a Developer provider is not offered), and "Not now" was not pressed
 * in the last 14 days. Both reads use the main window's parsers on the shared origin. A missing
 * key, a throwing storage or broken JSON reads as false: the window is complete without the line.
 */
export function connectOffer(storage: Pick<Storage, "getItem">, now: string): boolean {
  let settingsRaw: unknown;
  let guidedRaw: unknown;
  try {
    const settingsText = storage.getItem(SETTINGS_STORAGE_KEY);
    const guidedText = storage.getItem(GUIDED_STORAGE_KEY);
    if (settingsText === null || guidedText === null) return false;
    settingsRaw = JSON.parse(settingsText);
    guidedRaw = JSON.parse(guidedText);
  } catch {
    return false;
  }
  const explainer = parseSettings(settingsRaw).explainer;
  const signsIn = explainer.provider === "chatgpt" || explainer.provider === "claude_plan";
  return explainer.aiEnabled === true && signsIn && !aiAskedRecently(parseGuidedMemory(guidedRaw), now);
}
