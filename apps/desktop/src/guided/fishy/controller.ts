import { createContext, useContext } from "react";
import type { ActionId, FixError, SettingsPane, WatchActionId, WatchDetails, WatchItem } from "@talos/core";
import type { Route } from "../../app/router";

/**
 * The contract between the "something seems fishy" screens and the controller that drives them
 * (docs/DESIGN-WATCH.md section 6). The context defaults to an inert controller so a screen rendered
 * without App still works.
 */

export type FishyStage = "gate" | "noticed" | "disconnect" | "stop" | "eradicate" | "experts" | "recover";

export type FishyBusy = "idle" | "password" | "working";

export interface FishyController {
  readonly stage: FishyStage;
  /** The top item at the time the flow opened; null when the watch had none. */
  readonly item: WatchItem | null;
  /** Fetched once on the noticed screen; never sent anywhere. */
  readonly details: WatchDetails | null;
  /** details.wifiAvailable === false: the cable variant of screens 2 and 6. */
  readonly wired: boolean;
  readonly ransomNote: boolean;
  setRansomNote(value: boolean): void;
  readonly busy: FishyBusy;
  readonly error: FixError | null;
  /** Snapshots the top item and navigates to the fishy route. */
  open(returnTo: Route, start?: "gate" | "noticed"): void;
  next(): void;
  /** Snoozes the item for the action and goes back. */
  notNow(actionId: ActionId): void;
  /** "This is fine, I know it": acknowledges the item and goes back. */
  thisIsFine(): void;
  /** "Yes, that was me" re-baselines and goes back; "No, I didn't" carries on to the noticed screen. */
  answerGate(mine: boolean): void;
  /** Preview then apply of one WATCH_CATALOG row; advances on success. */
  runAction(actionId: WatchActionId): Promise<void>;
  /** Opens the pane, then asks the watch to re-read. */
  showPane(pane: SettingsPane): void;
  /** Finder reveal of the item's start-up entry. */
  reveal(): void;
  /** Opens the playbook URL from Rust, by action id. */
  openSource(actionId: ActionId): void;
  /** Records that the flow ran and goes back. */
  done(): void;
}

const noop = (): void => undefined;

export const INERT_FISHY: FishyController = {
  stage: "noticed",
  item: null,
  details: null,
  wired: false,
  ransomNote: false,
  setRansomNote: noop,
  busy: "idle",
  error: null,
  open: noop,
  next: noop,
  notNow: noop,
  thisIsFine: noop,
  answerGate: noop,
  runAction: async () => undefined,
  showPane: noop,
  reveal: noop,
  openSource: noop,
  done: noop,
};

export const FishyContext = createContext<FishyController>(INERT_FISHY);

/** Never throws: outside a provider it returns INERT_FISHY. */
export function useFishyController(): FishyController {
  return useContext(FishyContext);
}
