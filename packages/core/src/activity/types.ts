import type { RuleId } from "../domain/finding";
import type { SectionKey } from "../domain/system-state";
import type { FixError } from "../ports/fix-port";
import type { ProbeId } from "../ports/watch-port";

/** The activity timeline (docs/DESIGN-AGENT.md section 4). Core holds the shape and no string. */

export type ActivityKind =
  /** "Getting ready", at the tap, before fix_preview or fix_preview_batch resolves. */
  | "preparing"
  /** One row per phase Rust reports: an admin block (ruleId null, count n) or one item (ruleId set). */
  | "fixing"
  /** "Checking it worked", the verify-after-fix recheck. */
  | "rechecking"
  /** A show card's watcher. */
  | "watching"
  /** "Check now" from the open_watch card. */
  | "watch_check"
  /** A watch probe re-read; label by probe id, word same, changed or couldn't check. */
  | "probe"
  /** A check-up section re-read; label by section key, word still off or now on. */
  | "section";

export type ActivityStatus = "running" | "done" | "failed";

export type ProbeOutcomeWord = "same" | "changed" | "unavailable";

/** Mirrors the desktop scan machine's union. */
export type RecheckResult = "pass" | "still_failing" | "unreadable";

export type ActivityOutcome = FixError | RecheckResult | ProbeOutcomeWord | "still_off" | "now_on" | "waiting_for_password" | "stale" | null;

export interface ActivityEvent {
  /** One per row; a later event with the same id replaces the row in place. */
  readonly id: string;
  /** The chat card id, the guided step id, or the investigation's roundId. */
  readonly cardId: string;
  readonly kind: ActivityKind;
  readonly status: ActivityStatus;
  /** Date.now() of the first event for this id. */
  readonly at: number;
  readonly endedAt: number | null;
  /** fixing: the item; null for an admin block. */
  readonly ruleId: RuleId | null;
  /** fixing: items in the admin block; rechecking: areas; watching: polls so far. */
  readonly count: number | null;
  /** fixing, user-level: the Running step ("{i} of {n}" with `of`). */
  readonly step: number | null;
  readonly of: number | null;
  /** probe rows. */
  readonly probeId: ProbeId | null;
  /** section rows. */
  readonly sectionKey: SectionKey | null;
  /** The state word's input, read by the desktop's activityWord. */
  readonly outcome: ActivityOutcome;
  /** probe rows only: the judge's probes[].reason after safe_sentence, drawn inside the investigation message. */
  readonly modelLine: string | null;
}
