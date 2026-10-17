import type { FishyKind, Rating, SignalId, WatchContext, WatchRule, WatchSignal, WatchVerdict } from "../ports/watch-port";
import { RATING_ORDER, SIGNAL_IDS, SIGNAL_KIND, SIGNAL_POINTS } from "../ports/watch-port";
import { BAD_DIRECTION, GATED_SIGNALS, PAIR_SIGNALS, STAND_ALONE_SIGNALS, badFlip, pairGroup, siblings } from "./signals";

/**
 * The pure rating rules from docs/DESIGN-WATCH.md section 3. Rust watch/rate.rs mirrors every
 * function here and fixtures/watch-cases.json pins both sides.
 */

const DAY_MINUTES = 24 * 60;

function rank(rating: Rating): number {
  return RATING_ORDER.indexOf(rating);
}

export function maxRating(a: Rating, b: Rating): Rating {
  return rank(a) >= rank(b) ? a : b;
}

export function minRating(a: Rating, b: Rating): Rating {
  return rank(a) <= rank(b) ? a : b;
}

/** Changed, not acknowledged: the only signals that count. */
function active(signal: WatchSignal): boolean {
  return signal.change !== "same" && !signal.acknowledged;
}

function withinDay(signal: WatchSignal): boolean {
  return signal.minutesSinceChange === null || signal.minutesSinceChange <= DAY_MINUTES;
}

function isHigh(signal: WatchSignal): boolean {
  return signal.severity === "high" || signal.severity === "critical";
}

export interface Bounds {
  readonly floor: Rating;
  readonly ceiling: Rating;
}

/**
 * Floor is act_now on a stand-alone flip, a hidden account, a gated flip answered "No, I didn't",
 * or two pair signals from different listings (a gated flip counts as one) within 24 h. keep_an_eye on any high or medium
 * change within 24 h, an unanswered gate, a rule that appeared, or a signal that just became
 * unavailable. Ceiling is act_now only on an unacknowledged, ungated high change; keep_an_eye
 * on any unacknowledged change; calm otherwise.
 */
export function boundsFor(signals: readonly WatchSignal[], rules: readonly WatchRule[] = []): Bounds {
  const live = signals.filter(active);
  const standAlone = live.some((s) => STAND_ALONE_SIGNALS.includes(s.signalId) && badFlip(s));
  const gateAnsweredNo = live.some((s) => GATED_SIGNALS.includes(s.signalId) && badFlip(s) && !s.gated);
  // The three persistence counters rise from one listing, so they count once.
  const pairs = new Set(
    live.filter((s) => (PAIR_SIGNALS.includes(s.signalId) || GATED_SIGNALS.includes(s.signalId)) && badFlip(s) && withinDay(s)).map((s) => pairGroup(s.signalId)),
  );
  let floor: Rating = "calm";
  if (standAlone || gateAnsweredNo || pairs.size >= 2) {
    floor = "act_now";
  } else if (
    live.some((s) => (isHigh(s) || s.severity === "medium") && withinDay(s)) ||
    live.some((s) => s.gated) ||
    live.some((s) => s.freshness === "unavailable") ||
    rules.some((r) => r.change === "appeared")
  ) {
    floor = "keep_an_eye";
  }
  let ceiling: Rating = "calm";
  if (live.some((s) => isHigh(s) && !s.gated)) {
    ceiling = "act_now";
  } else if (live.length > 0) {
    ceiling = "keep_an_eye";
  }
  return { floor, ceiling };
}

export interface TopItem {
  readonly signalId: SignalId;
  readonly kind: FishyKind;
  readonly points: number;
}

/**
 * True when a changed signal is worth a headline: readable, and for a signal with a bad
 * direction, flipped that way; a cleared change never is. Rust `headline_worthy` mirrors it.
 */
function headlineWorthy(signal: WatchSignal): boolean {
  if (signal.freshness === "unavailable" || signal.change === "cleared") return false;
  if (BAD_DIRECTION[signal.signalId] !== undefined) return badFlip(signal);
  return true;
}

/**
 * A listing digest (sig.persistence_set, sig.listener_set) is worth a headline only when a
 * counter from the same listing rose: a removed launch item or a closed listener is a change to
 * look at, never "a new program". Rust `listing_worthy` mirrors it.
 */
function listingWorthy(signal: WatchSignal, signals: readonly WatchSignal[]): boolean {
  const group = siblings(signal.signalId);
  if (group.length < 2 || BAD_DIRECTION[signal.signalId] !== undefined) return true;
  return signals.some((s) => s.signalId !== signal.signalId && group.includes(s.signalId) && active(s) && badFlip(s));
}

/**
 * Kinded, changed, unacknowledged signals by points desc, then SIGNAL_IDS order, one per listing:
 * a new launch agent changes four signals and makes one item. A good flip or an unreadable probe
 * makes no item: the headlines all name a bad direction.
 */
export function topItems(signals: readonly WatchSignal[]): readonly TopItem[] {
  const items: TopItem[] = [];
  for (const signal of signals) {
    const kind = SIGNAL_KIND[signal.signalId];
    if (kind === null || !active(signal) || !headlineWorthy(signal) || !listingWorthy(signal, signals)) continue;
    items.push({ signalId: signal.signalId, kind, points: SIGNAL_POINTS[signal.severity] });
  }
  items.sort((a, b) => b.points - a.points || SIGNAL_IDS.indexOf(a.signalId) - SIGNAL_IDS.indexOf(b.signalId));
  const seen = new Set<SignalId>();
  return items.filter((item) => {
    const group = pairGroup(item.signalId);
    if (seen.has(group)) return false;
    seen.add(group);
    return true;
  });
}

/**
 * The shown rating: max(floor, min(verdict.rating, ceiling)). The first cycle rates nothing, and
 * act_now needs at least one item to show.
 */
export function rateWatch(context: WatchContext, verdict: Pick<WatchVerdict, "rating"> | null): Rating {
  if (context.cycle.index === 0) return "calm";
  const wanted = verdict === null ? context.floor : verdict.rating;
  const rating = maxRating(context.floor, minRating(wanted, context.ceiling));
  if (rating === "act_now" && topItems(context.signals).length === 0) return "keep_an_eye";
  return rating;
}

export interface Hysteresis {
  readonly rating: Rating;
  readonly calmStreak: number;
}

/** The rating rises at once and falls only after two consecutive lower cycles. */
export function applyHysteresis(previous: Rating, next: Rating, calmStreak: number): Hysteresis {
  if (rank(next) >= rank(previous)) return { rating: next, calmStreak: 0 };
  const streak = calmStreak + 1;
  if (streak >= 2) return { rating: next, calmStreak: 0 };
  return { rating: previous, calmStreak: streak };
}
