import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AWAY_GRACE_MS, AWAY_MAX_MS, awayPolling } from "./awayPolling";

type Listener = (focused: boolean) => void;

function bus() {
  let listener: Listener | null = null;
  return {
    source: (l: Listener) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    focus: (next: boolean) => listener?.(next),
    get subscribed() {
      return listener !== null;
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("awayPolling", () => {
  it("polls every interval while unfocused and stops on the first stop verdict", async () => {
    const b = bus();
    const poll = vi.fn(async () => (poll.mock.calls.length >= 3 ? "stop" : "continue") as "stop" | "continue");
    const poller = awayPolling({ everyMs: 2000, poll, onFocusChanged: b.source, initiallyFocused: false });
    await vi.advanceTimersByTimeAsync(1999);
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(poll).toHaveBeenCalledTimes(3);
    expect(poller.active).toBe(false);
    expect(b.subscribed).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("keeps polling for the grace period after focus returns, then pauses and reports it", async () => {
    const b = bus();
    const poll = vi.fn(async () => "continue" as const);
    const onPaused = vi.fn();
    awayPolling({ everyMs: 2000, poll, onFocusChanged: b.source, initiallyFocused: false, onPaused });
    await vi.advanceTimersByTimeAsync(4000);
    expect(poll).toHaveBeenCalledTimes(2);
    b.focus(true);
    await vi.advanceTimersByTimeAsync(AWAY_GRACE_MS);
    const during = poll.mock.calls.length;
    expect(during).toBeGreaterThanOrEqual(4);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll.mock.calls.length).toBeLessThanOrEqual(during + 1);
    expect(onPaused).toHaveBeenCalledTimes(1);
    b.focus(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll.mock.calls.length).toBeGreaterThan(during);
  });

  it("starts in grace when the window is focused, and stops at the cap", async () => {
    const b = bus();
    const poll = vi.fn(async () => "continue" as const);
    const onExpired = vi.fn();
    const poller = awayPolling({ everyMs: 1000, poll, onFocusChanged: b.source, initiallyFocused: true, onExpired });
    await vi.advanceTimersByTimeAsync(3000);
    expect(poll).toHaveBeenCalledTimes(3);
    b.focus(false);
    await vi.advanceTimersByTimeAsync(AWAY_MAX_MS);
    expect(poller.active).toBe(false);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it("stop() unsubscribes and a failed poll does not end the schedule", async () => {
    const b = bus();
    let n = 0;
    const poll = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("boom");
      return "continue" as const;
    });
    const poller = awayPolling({ everyMs: 500, poll, onFocusChanged: b.source, initiallyFocused: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(poll).toHaveBeenCalledTimes(2);
    poller.stop();
    expect(b.subscribed).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(2);
  });
});

describe("awayPolling pollOnFocusReturn", () => {
  it("polls at once when focus comes back and then keeps the interval", async () => {
    const b = bus();
    const poll = vi.fn(async () => "continue" as const);
    awayPolling({ everyMs: 2000, poll, onFocusChanged: b.source, initiallyFocused: false, pollOnFocusReturn: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    b.focus(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("waits for the interval without the flag and never polls twice at once", async () => {
    const b = bus();
    const poll = vi.fn(async () => "continue" as const);
    awayPolling({ everyMs: 2000, poll, onFocusChanged: b.source, initiallyFocused: false });
    await vi.advanceTimersByTimeAsync(500);
    b.focus(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(poll).not.toHaveBeenCalled();
    let release: () => void = () => undefined;
    const slow = vi.fn(() => new Promise<"continue">((resolve) => { release = () => resolve("continue"); }));
    const c = bus();
    awayPolling({ everyMs: 1000, poll: slow, onFocusChanged: c.source, initiallyFocused: false, pollOnFocusReturn: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(slow).toHaveBeenCalledTimes(1);
    c.focus(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(slow).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
  });
});
