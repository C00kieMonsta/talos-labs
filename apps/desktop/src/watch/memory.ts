import type { WatchMemory } from "@talos/core";
import { parseWatchMemory } from "@talos/core";

/** DESIGN-WATCH.md section 7: ids and dates only, parsed field by field like talos.guided. */
export const WATCH_STORAGE_KEY = "talos.watch";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** A damaged or missing value falls back to the empty memory. */
export function loadWatchMemory(): WatchMemory {
  const store = storage();
  if (store === null) return parseWatchMemory(null);
  let raw: unknown = null;
  try {
    const text = store.getItem(WATCH_STORAGE_KEY);
    raw = text === null ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  return parseWatchMemory(raw);
}

export function saveWatchMemory(memory: WatchMemory): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(WATCH_STORAGE_KEY, JSON.stringify(parseWatchMemory(memory)));
  } catch {
    // No storage: the watch forgets its snoozes on the next launch, nothing else.
  }
}
