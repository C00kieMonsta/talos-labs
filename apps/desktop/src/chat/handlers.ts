import type { ActivityEvent } from "@talos/core";
import type { Route } from "../app/router";
import type { ChipId } from "./state";

/** What the transcript's controls call; the controller implements it and the preview can stub it. */
export interface ChatHandlers {
  send(text: string): void;
  chip(id: ChipId): void;
  /** The card's one primary; a 029 card passes the typed passphrase. */
  primary(cardId: string, passphrase?: string): void;
  /** The card's one link: "Do this later", "Not now", "This is fine, I know it", "No, I'll get one later". */
  link(cardId: string): void;
  /** "Check again" on a show card while its watcher runs. */
  checkAgain(cardId: string): void;
  promote(rowId: string): void;
  stop(): void;
  /** The lock card's licence field verified a key. */
  licenceAccepted(cardId: string): void;
  navigate(route: Route): void;
  draftConsumed(): void;
}

/** Rows the chat adds beside the fix rows: the watcher and the watch check, keyed by card id. */
export type ActivityExtras = Readonly<Record<string, readonly ActivityEvent[]>>;

export const NO_EXTRAS: ActivityExtras = {};
