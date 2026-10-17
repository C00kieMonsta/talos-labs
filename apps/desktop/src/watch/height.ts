import type { WatchState } from "@talos/core";

/**
 * The window's height as Rust sizes it (tray.rs window_height; docs/DESIGN-WATCH-WINDOW.md
 * contract F): 16 px padding above and below, the rows present, 8 px between every two rows,
 * capped at 420. A row of 0 is not a row. Pinned to the shared fixture in height.test.ts.
 */

export const WATCH_WINDOW_MAX_HEIGHT = 420;
const PADDING = 32;
const GAP = 8;

/** The row budgets of the state, in order, zeros included. */
export function watchWindowRows(state: WatchState): readonly number[] {
  if (state.firstRun) return [58, 32, 32];
  const checked = state.checking || state.lastCheckAt !== null;
  if (state.pausedUntil !== null) return [24, checked ? 20 : 0, 20, 32];
  const judge = state.judge !== null && state.judge.rating === state.rating ? 72 : 0;
  if (state.rating === "calm") {
    const metaCalm = state.checking ? 20 : (state.lastCheckAt !== null ? 20 : 0) + 20;
    const unreadable = state.unavailable.length === 0 ? 0 : state.unavailable.length === 1 ? 40 : 60;
    const sentence = judge === 0 ? 20 : 72;
    const upNext = state.report !== null && state.next !== null && state.next.reportId === state.report.reportId ? 28 : 0;
    const row5 = state.ai.enabled ? 44 : state.ai.provider === null ? 52 : 0;
    return [24, metaCalm, unreadable, sentence, 20 + upNext, row5, 32];
  }
  const metaItem = checked ? (state.unavailable.length > 0 ? 40 : 20) : 0;
  if (state.rating === "keep_an_eye") {
    const body = state.items.length > 0 ? 92 : 20;
    return [24, metaItem, body, judge, 44, state.ai.enabled ? 32 : 0, 32];
  }
  return state.items.length > 0 ? [24, metaItem, 92, 40, 44, judge, 32] : [24, metaItem, 20, judge, 32];
}

/** The sum rule over the non-zero rows. */
export function watchWindowHeight(state: WatchState): number {
  const rows = watchWindowRows(state).filter((row) => row > 0);
  const sum = rows.reduce((total, row) => total + row, 0);
  return Math.min(WATCH_WINDOW_MAX_HEIGHT, PADDING + sum + GAP * (rows.length - 1));
}
