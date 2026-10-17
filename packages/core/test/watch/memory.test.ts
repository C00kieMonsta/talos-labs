import { describe, expect, it } from "vitest";
import { EMPTY_WATCH_MEMORY, WATCH_MUTE_COUNT, actionNotNowRecently, isMuted, parseWatchMemory } from "../../src/watch/memory";

const NOW = "2026-10-17T12:00:00.000Z";

describe("parseWatchMemory", () => {
  it("yields the empty memory for a non-object or a wrong version", () => {
    for (const raw of [null, undefined, "x", 1, [], {}, { version: 2 }, { version: "1" }]) expect(parseWatchMemory(raw)).toEqual(EMPTY_WATCH_MEMORY);
  });

  it("keeps only signal and action ids with ISO dates or counts, field by field", () => {
    const parsed = parseWatchMemory({
      version: 1,
      snoozedSignals: { "sig.firewall": NOW, "sig.nope": NOW, "sig.sip": "yesterday", "act.report": NOW },
      normalForMe: { "sig.share_count": NOW, 7: NOW },
      acknowledgeCount: { "sig.hosts_changed": 3, "sig.firewall": -1, "sig.sip": 1.5, "sig.nope": 2 },
      actionNotNow: { "act.report": NOW, "sig.firewall": NOW, "act.nope": NOW },
      fishyRanAt: NOW,
      notifiedItems: { "sig.persistence_new": NOW, "act.report": NOW },
      notifyAskedAt: NOW,
      extra: true,
    });
    expect(parsed).toEqual({
      version: 1,
      snoozedSignals: { "sig.firewall": NOW },
      normalForMe: { "sig.share_count": NOW },
      acknowledgeCount: { "sig.hosts_changed": 3 },
      actionNotNow: { "act.report": NOW },
      fishyRanAt: NOW,
      notifiedItems: { "sig.persistence_new": NOW },
      notifyAskedAt: NOW,
    });
    expect(parseWatchMemory({ version: 1, fishyRanAt: "soon", snoozedSignals: "x" })).toEqual(EMPTY_WATCH_MEMORY);
  });

  it("a blob written before notifyAskedAt existed parses with null, and a string round-trips", () => {
    const before = { version: 1, snoozedSignals: {}, normalForMe: {}, acknowledgeCount: {}, actionNotNow: {}, fishyRanAt: null, notifiedItems: {} };
    expect(parseWatchMemory(before).notifyAskedAt).toBeNull();
    expect(parseWatchMemory({ ...before, notifyAskedAt: 7 }).notifyAskedAt).toBeNull();
    expect(parseWatchMemory({ ...before, notifyAskedAt: NOW }).notifyAskedAt).toBe(NOW);
  });
});

describe("actionNotNowRecently", () => {
  it("honours Not now for 14 days and not a minute more", () => {
    const thirteen = new Date(Date.parse(NOW) - 13 * 86_400_000).toISOString();
    const fourteen = new Date(Date.parse(NOW) - 14 * 86_400_000).toISOString();
    expect(actionNotNowRecently({ actionNotNow: { "act.report": thirteen } }, "act.report", NOW)).toBe(true);
    expect(actionNotNowRecently({ actionNotNow: { "act.report": fourteen } }, "act.report", NOW)).toBe(false);
    expect(actionNotNowRecently({ actionNotNow: {} }, "act.report", NOW)).toBe(false);
    expect(actionNotNowRecently({ actionNotNow: { "act.report": "bad" } }, "act.report", NOW)).toBe(false);
  });
});

describe("isMuted", () => {
  it("mutes after three acknowledgements of the same signal", () => {
    expect(WATCH_MUTE_COUNT).toBe(3);
    expect(isMuted({ acknowledgeCount: { "sig.firewall": 2 } }, "sig.firewall")).toBe(false);
    expect(isMuted({ acknowledgeCount: { "sig.firewall": 3 } }, "sig.firewall")).toBe(true);
    expect(isMuted({ acknowledgeCount: {} }, "sig.firewall")).toBe(false);
  });
});
