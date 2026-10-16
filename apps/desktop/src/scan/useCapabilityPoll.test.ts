import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Capabilities } from "@talos/core";
import { AWAY_GRACE_MS } from "./awayPolling";
import { CAPABILITY_POLL_MS, CONTINUE_KEY, GRANTED_FLASH_MS, usePermissionFlow } from "./useCapabilityPoll";
import type { PermissionFlowDeps } from "./useCapabilityPoll";

function deps(answers: Capabilities[]): PermissionFlowDeps & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { capabilities: [], openPane: [], recheck: [], collectSection: [], restart: [] };
  let i = 0;
  return {
    calls,
    capabilities: async () => {
      calls.capabilities?.push([]);
      const next = answers[Math.min(i, answers.length - 1)] as Capabilities;
      i += 1;
      return next;
    },
    openPane: async (kind) => {
      calls.openPane?.push([kind]);
    },
    recheck: async (sections) => {
      calls.recheck?.push([sections]);
    },
    collectSection: async (key) => {
      calls.collectSection?.push([key]);
      return undefined;
    },
    restart: async () => {
      calls.restart?.push([]);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe("usePermissionFlow", () => {
  it("open: opens the pane, polls every 2 s while away, flashes granted, then rechecks the section for free", async () => {
    const d = deps([{ fullDiskAccess: false, automation: null, bundled: true }, { fullDiskAccess: true, automation: null, bundled: true }]);
    const { result } = renderHook(() => usePermissionFlow("full_disk_access", "not_granted", d));
    expect(result.current.state).toBe("not_granted");
    act(() => result.current.open());
    expect(d.calls.openPane).toEqual([["full_disk_access"]]);
    expect(result.current.state).toBe("watching");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPABILITY_POLL_MS);
    });
    expect(result.current.state).toBe("watching");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPABILITY_POLL_MS);
    });
    expect(result.current.state).toBe("granted");
    expect(d.calls.recheck).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRANTED_FLASH_MS);
    });
    expect(d.calls.recheck).toEqual([[["browsers"]]]);
    const polls = d.calls.capabilities?.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CAPABILITY_POLL_MS * 5);
    });
    expect(d.calls.capabilities?.length).toBe(polls);
  });

  it("moves to reopen_needed when focus has been back for the grace period and the grant has not shown, and Reopen records the continuation", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const d = deps([{ fullDiskAccess: false, automation: null, bundled: true }]);
    const { result } = renderHook(() => usePermissionFlow("full_disk_access", "not_granted", d));
    act(() => result.current.open());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AWAY_GRACE_MS + CAPABILITY_POLL_MS * 2);
    });
    expect(result.current.state).toBe("reopen_needed");
    act(() => result.current.reopen());
    expect(localStorage.getItem(CONTINUE_KEY)).toBe("fda");
    expect(d.calls.restart).toEqual([[]]);
  });

  it("Automation never asks for a reopen; Allow reads loginItems so macOS prompts, then rechecks", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const d = deps([{ fullDiskAccess: null, automation: "denied", bundled: true }]);
    const { result } = renderHook(() => usePermissionFlow("automation", "not_determined", d));
    act(() => result.current.allow());
    expect(result.current.state).toBe("prompting");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(d.calls.collectSection).toEqual([["loginItems"]]);
    expect(d.calls.recheck).toEqual([[["loginItems"]]]);
    act(() => result.current.open());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AWAY_GRACE_MS + CAPABILITY_POLL_MS * 2);
    });
    expect(result.current.state).toBe("watching");
  });
});
