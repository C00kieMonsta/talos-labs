/** Poll while the window is unfocused, keep going for a grace period after focus returns, stop at the cap. */

export const AWAY_GRACE_MS = 10_000;
export const AWAY_MAX_MS = 600_000;

export type FocusSource = (listener: (focused: boolean) => void) => () => void;

export interface AwayPollingOptions {
  readonly everyMs: number;
  /** Resolves "stop" when the condition is met; "continue" keeps polling. */
  readonly poll: () => Promise<"continue" | "stop">;
  readonly onFocusChanged?: FocusSource;
  readonly initiallyFocused?: boolean;
  /** Polling paused because focus has been back for the whole grace period. */
  readonly onPaused?: () => void;
  /** The cap was reached without the condition being met. */
  readonly onExpired?: () => void;
  readonly graceMs?: number;
  readonly maxMs?: number;
  /** Poll once as soon as focus comes back, before the next interval. */
  readonly pollOnFocusReturn?: boolean;
}

export interface AwayPoller {
  stop(): void;
  readonly active: boolean;
}

/** DOM focus and blur on the window; Tauri's webview raises both. */
export const windowFocus: FocusSource = (listener) => {
  const onFocus = () => listener(true);
  const onBlur = () => listener(false);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  };
};

export function awayPolling(options: AwayPollingOptions): AwayPoller {
  const graceMs = options.graceMs ?? AWAY_GRACE_MS;
  const maxMs = options.maxMs ?? AWAY_MAX_MS;
  const startedAt = Date.now();
  let focused = options.initiallyFocused ?? (typeof document !== "undefined" ? document.hasFocus() : true);
  let focusReturnedAt = focused ? startedAt : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let active = true;
  let paused = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const stop = () => {
    if (!active) return;
    active = false;
    clear();
    unsubscribe();
  };
  const inGrace = () => focusReturnedAt !== null && Date.now() - focusReturnedAt < graceMs;
  const shouldPoll = () => !focused || inGrace();

  const schedule = () => {
    clear();
    if (!active) return;
    if (Date.now() - startedAt >= maxMs) {
      stop();
      options.onExpired?.();
      return;
    }
    if (!shouldPoll()) {
      if (!paused) {
        paused = true;
        options.onPaused?.();
      }
      return;
    }
    paused = false;
    timer = setTimeout(() => void tick(), options.everyMs);
  };

  const tick = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const verdict = await options.poll();
      if (verdict === "stop") stop();
    } catch {
      // A failed poll is tried again on the next tick.
    } finally {
      inFlight = false;
    }
    schedule();
  };

  const unsubscribe = (options.onFocusChanged ?? windowFocus)((next) => {
    if (next === focused) return;
    focused = next;
    focusReturnedAt = next ? Date.now() : null;
    if (next && options.pollOnFocusReturn === true && active && !inFlight) {
      clear();
      void tick();
      return;
    }
    schedule();
  });

  schedule();
  return {
    stop,
    get active() {
      return active;
    },
  };
}
