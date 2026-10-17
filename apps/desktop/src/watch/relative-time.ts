import { formatTime } from "../app/labels";
import { WATCH } from "../guided/copy";
import { WATCH_WINDOW } from "./copy";

/** How long ago the last check ran, rounded for the watch window's meta line (docs/DESIGN-WATCH.md section 5). */
export type RelativeCheck = { readonly unit: "now" } | { readonly unit: "minutes"; readonly n: number } | { readonly unit: "hours"; readonly n: number };

const MINUTE_MS = 60_000;
const STEP_MINUTES = 5;
/** Under this many rounded minutes the line stays in minutes, so "hours" is always two or more. */
const HOURS_FROM_MINUTES = 90;
/** From this many rounded minutes the next check reads "about an hour". */
const ABOUT_AN_HOUR_FROM = 50;

function toMs(value: Date | string): number {
  return typeof value === "string" ? new Date(value).getTime() : value.getTime();
}

/** Minutes in 5-minute steps, then hours from 90 minutes on. A future or unreadable time reads as just now. */
export function relativeCheck(lastCheckAt: string, now: Date | string): RelativeCheck {
  const then = new Date(lastCheckAt).getTime();
  const current = toMs(now);
  if (Number.isNaN(then) || Number.isNaN(current)) return { unit: "now" };
  const minutes = Math.max(0, Math.floor((current - then) / MINUTE_MS));
  const rounded = Math.round(minutes / STEP_MINUTES) * STEP_MINUTES;
  if (rounded === 0) return { unit: "now" };
  if (rounded < HOURS_FROM_MINUTES) return { unit: "minutes", n: rounded };
  return { unit: "hours", n: Math.round(rounded / 60) };
}

/** The meta line text for a last check time. */
export function checkedLabel(lastCheckAt: string, now: Date | string): string {
  const relative = relativeCheck(lastCheckAt, now);
  switch (relative.unit) {
    case "now":
      return WATCH.checkedJustNow;
    case "minutes":
      return WATCH.checkedMinutes.replace("{n}", String(relative.n));
    case "hours":
      return WATCH.checkedHours.replace("{n}", String(relative.n));
  }
}

/**
 * The calm window's second meta line (docs/DESIGN-WATCH-WINDOW.md section 2). A closer watch
 * still running wins; a null, unreadable or past next check reads "soon"; otherwise the same
 * five-minute rounding as relativeCheck, "about an hour" from 50 to 90 rounded minutes.
 */
export function nextCheckLabel(nextCheckAt: string | null, now: Date | string, closeWatchUntil: string | null): string {
  const current = toMs(now);
  if (closeWatchUntil !== null) {
    const until = new Date(closeWatchUntil).getTime();
    if (!Number.isNaN(until) && !Number.isNaN(current) && until > current) return WATCH_WINDOW.closerWatch.replace("{time}", formatTime(closeWatchUntil));
  }
  if (nextCheckAt === null) return WATCH_WINDOW.nextCheckSoon;
  const then = new Date(nextCheckAt).getTime();
  if (Number.isNaN(then) || Number.isNaN(current) || then <= current) return WATCH_WINDOW.nextCheckSoon;
  const minutes = Math.floor((then - current) / MINUTE_MS);
  const rounded = Math.round(minutes / STEP_MINUTES) * STEP_MINUTES;
  if (rounded === 0) return WATCH_WINDOW.nextCheckSoon;
  if (rounded < ABOUT_AN_HOUR_FROM) return WATCH_WINDOW.nextCheckMinutes.replace("{n}", String(rounded));
  if (rounded <= HOURS_FROM_MINUTES) return WATCH_WINDOW.nextCheckHour;
  return WATCH_WINDOW.nextCheckHours.replace("{n}", String(Math.round(rounded / 60)));
}
