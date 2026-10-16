import type { GuidedMemory } from "@talos/core";
import { parseGuidedMemory } from "@talos/core";

export const GUIDED_STORAGE_KEY = "talos.guided";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Parsed field by field, so a damaged value falls back to the empty memory. */
export function loadGuidedMemory(): GuidedMemory {
  const store = storage();
  if (store === null) return parseGuidedMemory(null);
  let raw: unknown = null;
  try {
    const text = store.getItem(GUIDED_STORAGE_KEY);
    raw = text === null ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  return parseGuidedMemory(raw);
}

export function saveGuidedMemory(memory: GuidedMemory): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(GUIDED_STORAGE_KEY, JSON.stringify(parseGuidedMemory(memory)));
  } catch {
    // No storage: the guide forgets its snoozes on the next launch, nothing else.
  }
}

/** ISO date `days` after `now`. */
export function daysAfter(now: string, days: number): string {
  return new Date(new Date(now).getTime() + days * 86_400_000).toISOString();
}

/** ISO date `hours` after `now`. */
export function hoursAfter(now: string, hours: number): string {
  return new Date(new Date(now).getTime() + hours * 3_600_000).toISOString();
}
