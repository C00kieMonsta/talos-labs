import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { AiAvailability, AiAvailabilityDetail, ExplainerPort } from "@talos/core";
import { AI_TERMINAL_STATES } from "@talos/core";
import { noExplainer } from "../app/testing";
import { useAiAvailability } from "./useAiAvailability";

afterEach(cleanup);

function port(overrides: Partial<ExplainerPort>): ExplainerPort {
  return { ...noExplainer, ...overrides };
}

/** A stable factory, as App.tsx memoises its own; a new function per render would reset the state. */
function factory(explainer: ExplainerPort): () => Promise<ExplainerPort> {
  return async () => explainer;
}

describe("useAiAvailability", () => {
  it("is null until probed, then carries the state and no until for a plain availability", async () => {
    const make = factory(port({ availability: vi.fn(async () => "not_connected" as const) }));
    const { result } = renderHook(() => useAiAvailability(make));
    expect(result.current.availability).toBeNull();
    expect(result.current.until).toBeNull();
    let state: AiAvailability | null = null;
    await act(async () => {
      state = await result.current.probe();
    });
    expect(state).toBe("not_connected");
    expect(result.current.availability).toBe("not_connected");
    expect(result.current.until).toBeNull();
  });

  it("prefers availabilityDetail and exposes its until", async () => {
    const detail: AiAvailabilityDetail = { state: "limit_reached", until: "2026-10-16T18:00:00.000Z" };
    const availability = vi.fn(async () => "available" as const);
    const availabilityDetail = vi.fn(async (fresh?: boolean) => (fresh === true ? { state: "available" as const, until: null } : detail));
    const make = factory(port({ availability, availabilityDetail }));
    const { result } = renderHook(() => useAiAvailability(make));
    await act(async () => {
      await result.current.probe();
    });
    expect(result.current.availability).toBe("limit_reached");
    expect(result.current.until).toBe("2026-10-16T18:00:00.000Z");
    expect(availability).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.probe(true);
    });
    expect(availabilityDetail).toHaveBeenLastCalledWith(true);
    expect(result.current.availability).toBe("available");
    expect(result.current.until).toBeNull();
  });

  it("maps a throwing probe to helper_unavailable", async () => {
    const make = async (): Promise<ExplainerPort> => {
      throw new Error("no helper");
    };
    const { result } = renderHook(() => useAiAvailability(make));
    await act(async () => {
      await result.current.probe();
    });
    expect(result.current.availability).toBe("helper_unavailable");
  });

  it("shares one in-flight probe", async () => {
    const availability = vi.fn(async () => "available" as const);
    const make = factory(port({ availability }));
    const { result } = renderHook(() => useAiAvailability(make));
    await act(async () => {
      await Promise.all([result.current.probe(), result.current.probe()]);
    });
    expect(availability).toHaveBeenCalledTimes(1);
  });

  it("runs a fresh probe after an in-flight cached one instead of riding on it", async () => {
    let release: (detail: AiAvailabilityDetail) => void = () => undefined;
    const calls: boolean[] = [];
    const availabilityDetail = vi.fn((fresh?: boolean) => {
      calls.push(fresh === true);
      // Only the first cached probe hangs until released; everything after answers at once.
      if (calls.length > 1) return Promise.resolve({ state: "available" as const, until: null });
      return new Promise<AiAvailabilityDetail>((resolve) => (release = resolve));
    });
    const make = factory(port({ availabilityDetail }));
    const { result } = renderHook(() => useAiAvailability(make));
    let cached: Promise<AiAvailability> = Promise.resolve("off");
    let fresh: Promise<AiAvailability> = Promise.resolve("off");
    await act(async () => {
      cached = result.current.probe();
      fresh = result.current.probe(true);
      // Let the factory resolve so the cached probe reaches the port.
      await Promise.resolve();
      await Promise.resolve();
    });
    // The fresh probe waits for the cached one; nothing fresh has been asked yet.
    expect(calls).toEqual([false]);
    await act(async () => {
      release({ state: "needs_sign_in", until: null });
      expect(await cached).toBe("needs_sign_in");
      expect(await fresh).toBe("available");
    });
    expect(calls).toEqual([false, true]);
    expect(result.current.availability).toBe("available");
    // A later cached probe runs on its own again: the chain left no in-flight promise behind.
    await act(async () => {
      await result.current.probe();
    });
    expect(calls).toEqual([false, true, false]);
  });

  it("forgets the state when the explainer factory changes", async () => {
    const first = factory(port({ availability: async () => "available" as const }));
    const second = factory(port({ availability: async () => "not_connected" as const }));
    const { result, rerender } = renderHook(({ make }) => useAiAvailability(make), { initialProps: { make: first } });
    await act(async () => {
      await result.current.probe();
    });
    expect(result.current.availability).toBe("available");
    rerender({ make: second });
    expect(result.current.availability).toBeNull();
  });

  describe("reprobe", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps probing fresh through the non-terminal states and stops on a terminal one", async () => {
      const states: AiAvailability[] = ["connecting", "needs_sign_in", "limit_reached", "provider_unavailable", "model_not_ready", "plan_not_eligible", "available"];
      const availability = vi.fn(async () => states.shift() ?? ("available" as const));
      const make = factory(port({ availability }));
      const { result } = renderHook(() => useAiAvailability(make));
      act(() => {
        result.current.reprobe(1000);
      });
      for (let i = 0; i < 6; i += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      expect(availability).toHaveBeenCalledTimes(6);
      expect(availability).toHaveBeenLastCalledWith(true);
      expect(result.current.availability).toBe("plan_not_eligible");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      // plan_not_eligible is terminal: no further probe.
      expect(availability).toHaveBeenCalledTimes(6);
    });

    it("stops on each terminal state", async () => {
      for (const terminal of AI_TERMINAL_STATES) {
        const availability = vi.fn(async () => terminal);
        const make = factory(port({ availability }));
        const { result, unmount } = renderHook(() => useAiAvailability(make));
        act(() => {
          result.current.reprobe(500);
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2500);
        });
        expect(availability, terminal).toHaveBeenCalledTimes(1);
        unmount();
      }
    });

    it("stops at the cap and when the stop function is called", async () => {
      const availability = vi.fn(async () => "not_connected" as const);
      const make = factory(port({ availability }));
      const { result } = renderHook(() => useAiAvailability(make));
      let stop: () => void = () => undefined;
      act(() => {
        stop = result.current.reprobe(1000, 3500);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(availability).toHaveBeenCalledTimes(3);
      act(() => {
        stop = result.current.reprobe(1000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      act(() => stop());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(availability).toHaveBeenCalledTimes(5);
      expect(result.current.availability).toBe("not_connected");
    });
  });
});
