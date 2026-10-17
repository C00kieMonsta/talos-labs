import { createContext, useContext } from "react";
import type { ActionId, SignalId, WatchInterval, WatchMemory, WatchState } from "@talos/core";
import { EMPTY_WATCH_MEMORY } from "@talos/core";

/**
 * What the screens read of the menu bar watch (docs/DESIGN-WATCH.md). useWatch in App builds
 * it over the WatchPort; the context defaults to an inert controller so a screen rendered
 * without App still works. The controller never calls setEnabled, setInterval, setNotify or
 * requestNotifyPermission on its own: each is a person's press.
 */
export interface WatchController {
  /** null until status() has answered. */
  readonly state: WatchState | null;
  readonly memory: WatchMemory;
  /** null until autostartIsEnabled() has answered. */
  readonly startAtLogin: boolean | null;
  saveMemory(next: WatchMemory): void;
  checkNow(): void;
  pause(): void;
  setEnabled(v: boolean): Promise<void>;
  setInterval(m: WatchInterval): Promise<void>;
  /** Records the flag only; the Settings switch and the Welcome button ask for the permission themselves. */
  setNotify(v: boolean): Promise<void>;
  setStartAtLogin(v: boolean): Promise<void>;
  requestNotifyPermission(): Promise<void>;
  /** "This is fine, I know it": normalForMe plus the acknowledge count, then the port re-baselines. */
  acknowledge(signalId: SignalId): Promise<void>;
  answerGate(signalId: SignalId, mine: boolean): Promise<void>;
  /** "Not now": actionNotNow for 14 days plus the port's snooze on the item. */
  notNow(actionId: ActionId, signalId: SignalId): Promise<void>;
  openSource(actionId: ActionId): void;
  markFishyRan(): void;
}

const noop = (): void => undefined;
const resolved = async (): Promise<void> => undefined;

export const INERT_WATCH: WatchController = {
  state: null,
  memory: EMPTY_WATCH_MEMORY,
  startAtLogin: null,
  saveMemory: noop,
  checkNow: noop,
  pause: noop,
  setEnabled: resolved,
  setInterval: resolved,
  setNotify: resolved,
  setStartAtLogin: resolved,
  requestNotifyPermission: resolved,
  acknowledge: resolved,
  answerGate: resolved,
  notNow: resolved,
  openSource: noop,
  markFishyRan: noop,
};

export const WatchControllerContext = createContext<WatchController>(INERT_WATCH);

/** Never throws: outside a provider it returns INERT_WATCH. */
export function useWatchController(): WatchController {
  return useContext(WatchControllerContext);
}
