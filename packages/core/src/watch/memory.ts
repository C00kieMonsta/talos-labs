import { AI_ASK_AGAIN_MS } from "../guided/memory";
import type { ActionId, SignalId, WatchMemory } from "../ports/watch-port";
import { ACTION_IDS, SIGNAL_IDS } from "../ports/watch-port";

export const EMPTY_WATCH_MEMORY: WatchMemory = {
  version: 1,
  snoozedSignals: {},
  normalForMe: {},
  acknowledgeCount: {},
  actionNotNow: {},
  fishyRanAt: null,
  notifiedItems: {},
  notifyAskedAt: null,
};

/** "This is fine, I know it" this many times on one signal mutes it until a full check sees a new change. */
export const WATCH_MUTE_COUNT = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isSignalId(value: string): value is SignalId {
  return (SIGNAL_IDS as readonly string[]).includes(value);
}

function isActionId(value: string): value is ActionId {
  return (ACTION_IDS as readonly string[]).includes(value);
}

function dateMap(value: unknown, keyOk: (key: string) => boolean): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, until] of Object.entries(value)) {
    if (keyOk(key) && isIsoDate(until)) out[key] = until;
  }
  return out;
}

function countMap(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (isSignalId(key) && typeof count === "number" && Number.isInteger(count) && count >= 0) out[key] = count;
  }
  return out;
}

/** Field by field with fallbacks, like parseGuidedMemory. A wrong version or a non-object yields the empty memory. */
export function parseWatchMemory(raw: unknown): WatchMemory {
  if (!isRecord(raw) || raw["version"] !== 1) return EMPTY_WATCH_MEMORY;
  return {
    version: 1,
    snoozedSignals: dateMap(raw["snoozedSignals"], isSignalId),
    normalForMe: dateMap(raw["normalForMe"], isSignalId),
    acknowledgeCount: countMap(raw["acknowledgeCount"]),
    actionNotNow: dateMap(raw["actionNotNow"], isActionId),
    fishyRanAt: isIsoDate(raw["fishyRanAt"]) ? raw["fishyRanAt"] : null,
    notifiedItems: dateMap(raw["notifiedItems"], isSignalId),
    notifyAskedAt: isIsoDate(raw["notifyAskedAt"]) ? raw["notifyAskedAt"] : null,
  };
}

/** True when "Not now" was pressed on the action less than 14 days before now. */
export function actionNotNowRecently(memory: Pick<WatchMemory, "actionNotNow">, actionId: ActionId, now: string): boolean {
  const asked = memory.actionNotNow[actionId];
  if (asked === undefined) return false;
  const at = Date.parse(now);
  const when = Date.parse(asked);
  if (Number.isNaN(at) || Number.isNaN(when)) return false;
  return at - when < AI_ASK_AGAIN_MS;
}

/** True after WATCH_MUTE_COUNT acknowledgements of the same signal. */
export function isMuted(memory: Pick<WatchMemory, "acknowledgeCount">, signalId: SignalId): boolean {
  return (memory.acknowledgeCount[signalId] ?? 0) >= WATCH_MUTE_COUNT;
}
