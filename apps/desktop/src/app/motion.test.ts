// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StrictMode } from "react";
import { act, renderHook } from "@testing-library/react";
import { MOTION, motionOff, useEased } from "./motion";

const tokens = readFileSync(join(__dirname, "..", "styles", "tokens.css"), "utf8");
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
  delete window.__talosDemoPace;
});

function token(name: string): number {
  const match = new RegExp(`--motion-${name}:\\s*(\\d+)ms;`).exec(tokens);
  if (match === null) throw new Error(`no --motion-${name} token`);
  return Number(match[1]);
}

describe("MOTION", () => {
  it("matches the six duration tokens in tokens.css", () => {
    expect(tokens).toContain("--motion-fast: 150ms");
    expect(tokens).toContain("--motion-base: 200ms");
    expect(tokens).toContain("--motion-slow: 250ms");
    expect(tokens).toContain("--motion-settle: 600ms");
    expect(tokens).toContain("--motion-fill: 900ms");
    expect(tokens).toContain("--motion-breathe: 3000ms");
    for (const name of ["fast", "base", "slow", "settle", "fill", "breathe"] as const) expect(MOTION[name]).toBe(token(name));
  });
});

describe("motionOff", () => {
  it("is false with no matchMedia and no demo pace", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(motionOff()).toBe(false);
  });

  it("is true under the reduce media query", () => {
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;
    expect(motionOff()).toBe(true);
  });

  it("is true at demo pace 0", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    window.__talosDemoPace = 0;
    expect(motionOff()).toBe(true);
  });
});

describe("useEased", () => {
  it("starts at 0, reaches the target by firstMs and never exceeds it", () => {
    vi.useFakeTimers();
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useEased(80));
    expect(result.current).toBe(0);
    let peak = 0;
    for (let i = 0; i < 20; i += 1) {
      act(() => {
        vi.advanceTimersByTime((MOTION.fill + 100) / 20);
      });
      peak = Math.max(peak, result.current);
    }
    expect(result.current).toBe(80);
    expect(peak).toBeLessThanOrEqual(80);
  });

  it("keeps the first duration under StrictMode's doubled effect", () => {
    vi.useFakeTimers();
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useEased(80), { wrapper: StrictMode });
    act(() => {
      vi.advanceTimersByTime(MOTION.settle + 50);
    });
    expect(result.current).toBeLessThan(80);
    act(() => {
      vi.advanceTimersByTime(MOTION.fill);
    });
    expect(result.current).toBe(80);
  });

  it("a new restart token runs the first fill again from 0", () => {
    vi.useFakeTimers();
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const { result, rerender } = renderHook(({ restart }: { restart: number }) => useEased(80, MOTION.fill, MOTION.settle, restart), { initialProps: { restart: 0 } });
    act(() => {
      vi.advanceTimersByTime(MOTION.fill + 100);
    });
    expect(result.current).toBe(80);
    rerender({ restart: 1 });
    expect(result.current).toBe(0);
    act(() => {
      vi.advanceTimersByTime(MOTION.settle + 50);
    });
    expect(result.current).toBeLessThan(80);
    act(() => {
      vi.advanceTimersByTime(MOTION.fill);
    });
    expect(result.current).toBe(80);
  });

  it("returns the target on the first render when motion is off", () => {
    window.__talosDemoPace = 0;
    const { result } = renderHook(() => useEased(42));
    expect(result.current).toBe(42);
  });
});
