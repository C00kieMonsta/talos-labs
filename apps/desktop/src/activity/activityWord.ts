import type { ActivityEvent } from "@talos/core";
import { ACTIVITY } from "../guided/copy";

type Words = typeof ACTIVITY.words;

/** The row's visible state word, lower-case, from its status and outcome. */
export function activityWord(event: ActivityEvent, words: Words = ACTIVITY.words): string {
  switch (event.status) {
    case "running":
      if (event.outcome === "waiting_for_password") return words.password;
      if (event.step !== null && event.of !== null) return words.running.replace("{i}", String(event.step)).replace("{n}", String(event.of));
      if (event.kind === "watching") return words.watching;
      return words.working;
    case "done":
      if (event.kind === "probe") return event.outcome === "changed" ? words.changed : event.outcome === "unavailable" ? words.couldNotCheck : words.same;
      if (event.kind === "section") return words.nowOn;
      return words.done;
    case "failed":
      switch (event.outcome) {
        case "cancelled":
        case "wrong_password":
          return words.stopped;
        case "unreadable":
        case "unavailable":
          return words.couldNotCheck;
        case "still_failing":
          return words.notChangedYet;
        case "stale":
          return words.noChange;
        case "still_off":
          return words.stillOff;
        default:
          return words.didNotChange;
      }
  }
}
