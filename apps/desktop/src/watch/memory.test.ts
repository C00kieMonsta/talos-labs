import { afterEach, describe, expect, it } from "vitest";
import { actionNotNowRecently, EMPTY_WATCH_MEMORY, isMuted, WATCH_MUTE_COUNT } from "@talos/core";
import { loadWatchMemory, saveWatchMemory, WATCH_STORAGE_KEY } from "./memory";

const NOW = "2026-10-17T12:00:00.000Z";
const DAY_MS = 86_400_000;

afterEach(() => {
  localStorage.clear();
});

describe("watch memory storage", () => {
  it("uses the talos.watch key and round-trips a memory", () => {
    expect(WATCH_STORAGE_KEY).toBe("talos.watch");
    const memory = {
      ...EMPTY_WATCH_MEMORY,
      snoozedSignals: { "sig.persistence_new": NOW },
      normalForMe: { "sig.share_count": NOW },
      acknowledgeCount: { "sig.share_count": 2 },
      actionNotNow: { "act.disconnect_network": NOW },
      fishyRanAt: NOW,
      notifiedItems: { "sig.persistence_new": NOW },
    };
    saveWatchMemory(memory);
    expect(JSON.parse(localStorage.getItem(WATCH_STORAGE_KEY) ?? "null")).toEqual(memory);
    expect(loadWatchMemory()).toEqual(memory);
  });

  it("loads the empty memory when nothing is stored, the JSON is broken, or the version is wrong", () => {
    expect(loadWatchMemory()).toEqual(EMPTY_WATCH_MEMORY);
    localStorage.setItem(WATCH_STORAGE_KEY, "{not json");
    expect(loadWatchMemory()).toEqual(EMPTY_WATCH_MEMORY);
    localStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify({ version: 2, fishyRanAt: NOW }));
    expect(loadWatchMemory()).toEqual(EMPTY_WATCH_MEMORY);
  });

  it("parses field by field: unknown ids, bad dates and negative counts are dropped, the rest kept", () => {
    localStorage.setItem(
      WATCH_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        snoozedSignals: { "sig.persistence_new": NOW, "sig.nope": NOW, "sig.firewall": "yesterday" },
        normalForMe: { "/tmp/x": NOW, "sig.firewall": NOW },
        acknowledgeCount: { "sig.firewall": 3, "sig.share_count": -1, "sig.sip": 1.5, "act.report": 2 },
        actionNotNow: { "act.report": NOW, "sig.firewall": NOW, "act.nope": NOW },
        fishyRanAt: "never",
        notifiedItems: "none",
      }),
    );
    expect(loadWatchMemory()).toEqual({
      version: 1,
      snoozedSignals: { "sig.persistence_new": NOW },
      normalForMe: { "sig.firewall": NOW },
      acknowledgeCount: { "sig.firewall": 3 },
      actionNotNow: { "act.report": NOW },
      fishyRanAt: null,
      notifiedItems: {},
    });
  });

  it("saving writes the parsed form, so junk never reaches storage", () => {
    saveWatchMemory({ ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.report": NOW, "http://x": NOW } });
    expect(localStorage.getItem(WATCH_STORAGE_KEY)).not.toContain("http");
  });
});

describe("watch memory rules", () => {
  it("three acknowledgements mute a signal", () => {
    expect(WATCH_MUTE_COUNT).toBe(3);
    expect(isMuted({ acknowledgeCount: { "sig.share_count": 2 } }, "sig.share_count")).toBe(false);
    expect(isMuted({ acknowledgeCount: { "sig.share_count": 3 } }, "sig.share_count")).toBe(true);
    expect(isMuted({ acknowledgeCount: {} }, "sig.share_count")).toBe(false);
  });

  it("Not now on an action is honoured for 14 days, then expires", () => {
    const memory = { actionNotNow: { "act.disconnect_network": NOW } };
    expect(actionNotNowRecently(memory, "act.disconnect_network", NOW)).toBe(true);
    expect(actionNotNowRecently(memory, "act.disconnect_network", new Date(Date.parse(NOW) + 13 * DAY_MS).toISOString())).toBe(true);
    expect(actionNotNowRecently(memory, "act.disconnect_network", new Date(Date.parse(NOW) + 14 * DAY_MS).toISOString())).toBe(false);
    expect(actionNotNowRecently(memory, "act.report", NOW)).toBe(false);
  });
});
