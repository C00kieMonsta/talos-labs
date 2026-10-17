/** Timers the guide owns. Every one collapses to 0 when the demo pace is 0. */

export const AUTO_ADVANCE_MS = 1400;
export const AUTO_ADVANCE_REDUCED_MS = 1800;
export const LATER_FLASH_MS = 800;
export const QUESTION_FLASH_MS = 1400;
export const THANK_YOU_MS = 800;
/** "OK, I'll leave it alone." stays long enough to read. */
export const ACCEPT_FLASH_MS = 1400;
/** Focus back this long with no change: the watching step reads as stale. */
export const STALE_AFTER_MS = 10_000;
/** The launch scan does not start twice within this window in one process. */
export const LAUNCH_SCAN_GUARD_MS = 60_000;

function pace(): number {
  if (typeof window === "undefined") return 1;
  const value = window.__talosDemoPace;
  return typeof value === "number" && value >= 0 ? value : 1;
}

/** `ms` scaled by the demo pace; a pace of 0 collapses every guided timer. */
export function paced(ms: number): number {
  return Math.round(ms * pace());
}

export function autoAdvanceMs(reducedMotion: boolean): number {
  return paced(reducedMotion ? AUTO_ADVANCE_REDUCED_MS : AUTO_ADVANCE_MS);
}

let lastLaunchScanAt: number | null = null;

/** True once per LAUNCH_SCAN_GUARD_MS in this process; covers StrictMode's double effect and a relaunch loop. */
export function claimLaunchScan(now: number = Date.now()): boolean {
  if (lastLaunchScanAt !== null && now - lastLaunchScanAt < LAUNCH_SCAN_GUARD_MS) return false;
  lastLaunchScanAt = now;
  return true;
}

/** Developer mode "Skip the cooldown". */
export function resetLaunchGuard(): void {
  lastLaunchScanAt = null;
}
