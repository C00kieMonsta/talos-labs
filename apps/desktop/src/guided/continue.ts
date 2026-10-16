/** The relaunch note left in localStorage before a permission grant or a guided reopen. */

export const CONTINUE_KEY = "talos.continue";

export type ContinuePayload = { readonly kind: "fda" } | { readonly kind: "guided" };

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Parses a stored value. The v0.2 bare "fda" string is still accepted. */
export function parseContinue(raw: string | null): ContinuePayload | null {
  if (raw === null) return null;
  if (raw === "fda") return { kind: "fda" };
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || !("kind" in value)) return null;
    const kind = (value as { kind: unknown }).kind;
    return kind === "fda" || kind === "guided" ? { kind } : null;
  } catch {
    return null;
  }
}

/** Reads and clears the note, so a relaunch acts on it once. */
export function readContinue(): ContinuePayload | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(CONTINUE_KEY);
    store.removeItem(CONTINUE_KEY);
    return parseContinue(raw);
  } catch {
    return null;
  }
}

export function writeContinue(payload: ContinuePayload): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(CONTINUE_KEY, JSON.stringify(payload));
  } catch {
    // No storage: the relaunch lands on a fresh scan anyway.
  }
}
