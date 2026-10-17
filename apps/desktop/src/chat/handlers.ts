import type { ActivityEvent } from "@talos/core";
import type { Route } from "../app/router";
import type { ChipId } from "./state";

/** What the transcript's controls call; the controller implements it and the preview can stub it. */
export interface ChatHandlers {
  /** True when the text went out; false when a guard line answered and the draft stays in the field. */
  send(text: string): boolean;
  chip(id: ChipId): void;
  /** The card's one primary; a 029 card passes the typed passphrase. */
  primary(cardId: string, passphrase?: string): void;
  /** The card's one link: "Do this later", "Not now", "This is fine, I know it", "No, I'll get one later". */
  link(cardId: string): void;
  /** "Check again" on a show card while its watcher runs. */
  checkAgain(cardId: string): void;
  promote(rowId: string): void;
  /** A tapped checklist row (DESIGN-AGENT 2c): that step becomes the live card out of order. */
  promoteStep(stepId: string): void;
  stop(): void;
  /** The lock card's licence field verified a key. */
  licenceAccepted(cardId: string): void;
  navigate(route: Route): void;
  draftConsumed(): void;
  /** The Explain disclosure's state line, spoken by the one status element rather than a live region inside the log. */
  explainState(text: string): void;
}

/** Rows the chat adds beside the fix rows: the watcher and the watch check, keyed by card id. */
export type ActivityExtras = Readonly<Record<string, readonly ActivityEvent[]>>;

export const NO_EXTRAS: ActivityExtras = {};
