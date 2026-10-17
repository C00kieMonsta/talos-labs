import { WATCH } from "../guided/copy";

/** How long ago the last check ran, rounded for the watch window's meta line (docs/DESIGN-WATCH.md section 5). */
export type RelativeCheck = { readonly unit: "now" } | { readonly unit: "minutes"; readonly n: number } | { readonly unit: "hours"; readonly n: number };

const MINUTE_MS = 60_000;
const STEP_MINUTES = 5;
/** Under this many rounded minutes the line stays in minutes, so "hours" is always two or more. */
const HOURS_FROM_MINUTES = 90;

/** Minutes in 5-minute steps, then hours from 90 minutes on. A future or unreadable time reads as just now. */
export function relativeCheck(lastCheckAt: string, now: Date | string): RelativeCheck {
  const then = new Date(lastCheckAt).getTime();
  const current = typeof now === "string" ? new Date(now).getTime() : now.getTime();
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
