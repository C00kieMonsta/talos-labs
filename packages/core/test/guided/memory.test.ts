import { describe, expect, it } from "vitest";
import { AI_ASK_AGAIN_MS, AI_LAST_AVAILABLE_TTL_MS, EMPTY_GUIDED_MEMORY, aiAskedRecently, aiAvailableRecently, parseGuidedMemory } from "../../src/guided/memory";

describe("parseGuidedMemory", () => {
  it("null, a string and an array give the empty memory", () => {
    expect(parseGuidedMemory(null)).toEqual(EMPTY_GUIDED_MEMORY);
    expect(parseGuidedMemory("damaged")).toEqual(EMPTY_GUIDED_MEMORY);
    expect(parseGuidedMemory([1, 2])).toEqual(EMPTY_GUIDED_MEMORY);
    expect(parseGuidedMemory(undefined)).toEqual(EMPTY_GUIDED_MEMORY);
  });

  it("a wrong or missing version gives the empty memory", () => {
    expect(parseGuidedMemory({ version: 2, snoozed: { "TL-MAC-001": "2026-10-20T00:00:00.000Z" } })).toEqual(EMPTY_GUIDED_MEMORY);
    expect(parseGuidedMemory({ snoozed: {} })).toEqual(EMPTY_GUIDED_MEMORY);
  });

  it("round-trips a full value and drops unknown keys", () => {
    const value = {
      version: 1,
      snoozed: { "TL-MAC-001": "2026-10-22T10:00:00.000Z" },
      laterCount: { "TL-MAC-010": 2 },
      waiting: { "TL-MAC-026": "2026-10-16T10:00:00.000Z" },
      pendingRestart: ["TL-MAC-001"],
      paywallSnoozedUntil: "2026-10-29T10:00:00.000Z",
      permissionAskedAt: { full_disk_access: "2026-10-15T10:00:00.000Z" },
      aiAskedAt: "2026-10-14T10:00:00.000Z",
      accepted: { "TL-MAC-001": "2026-10-10T09:00:00.000Z" },
      aiLastAvailable: { provider: "chatgpt", at: "2026-10-16T09:00:00.000Z" },
      extra: "ignored",
      lastStep: 3,
    };
    const { extra, lastStep, ...expected } = value;
    void extra;
    void lastStep;
    expect(parseGuidedMemory(value)).toEqual(expected);
  });

  it("repairs each damaged field on its own", () => {
    const parsed = parseGuidedMemory({
      version: 1,
      snoozed: { "TL-MAC-001": "not a date", "TL-MAC-002": "2026-10-22T10:00:00.000Z", "/etc/passwd": "2026-10-22T10:00:00.000Z" },
      laterCount: { "TL-MAC-010": "2", "TL-MAC-011": -1, "TL-MAC-012": 1.5, "TL-MAC-013": 1 },
      waiting: "soon",
      pendingRestart: ["TL-MAC-001", "nope", 7, "TL-MAC-001"],
      paywallSnoozedUntil: 42,
      permissionAskedAt: { full_disk_access: "2026-10-15T10:00:00.000Z", camera: "2026-10-15T10:00:00.000Z", automation: 3 },
      aiAskedAt: "yesterday",
      accepted: { "TL-MAC-001": "2026-10-10T09:00:00.000Z", "TL-MAC-002": "last week", "/Users/alice": "2026-10-10T09:00:00.000Z" },
      aiLastAvailable: { provider: "chatgpt", at: "not a date" },
    });
    expect(parsed).toEqual({
      version: 1,
      snoozed: { "TL-MAC-002": "2026-10-22T10:00:00.000Z" },
      laterCount: { "TL-MAC-013": 1 },
      waiting: {},
      pendingRestart: ["TL-MAC-001"],
      paywallSnoozedUntil: null,
      permissionAskedAt: { full_disk_access: "2026-10-15T10:00:00.000Z" },
      aiAskedAt: null,
      accepted: { "TL-MAC-001": "2026-10-10T09:00:00.000Z" },
      aiLastAvailable: null,
    });
  });

  it("reads aiLastAvailable as a known provider with a date, else null", () => {
    expect(EMPTY_GUIDED_MEMORY.aiLastAvailable).toBeNull();
    expect(parseGuidedMemory({ version: 1 }).aiLastAvailable).toBeNull();
    expect(parseGuidedMemory({ version: 1, aiLastAvailable: { provider: "claude_plan", at: "2026-10-16T09:00:00.000Z" } }).aiLastAvailable).toEqual({ provider: "claude_plan", at: "2026-10-16T09:00:00.000Z" });
    expect(parseGuidedMemory({ version: 1, aiLastAvailable: { provider: "none", at: "2026-10-16T09:00:00.000Z" } }).aiLastAvailable).toBeNull();
    expect(parseGuidedMemory({ version: 1, aiLastAvailable: { provider: "chatgpt" } }).aiLastAvailable).toBeNull();
    expect(parseGuidedMemory({ version: 1, aiLastAvailable: "chatgpt" }).aiLastAvailable).toBeNull();
    expect(parseGuidedMemory({ version: 1, aiLastAvailable: { provider: "chatgpt", at: "2026-10-16T09:00:00.000Z", extra: 1 } }).aiLastAvailable).toEqual({ provider: "chatgpt", at: "2026-10-16T09:00:00.000Z" });
  });

  it("accepted holds rule ids and dates only, and an older memory loads with an empty map", () => {
    expect(EMPTY_GUIDED_MEMORY.accepted).toEqual({});
    expect(parseGuidedMemory({ version: 1 }).accepted).toEqual({});
    expect(parseGuidedMemory({ version: 1, accepted: { "TL-MAC-001": "2026-10-10T09:00:00.000Z" } }).accepted).toEqual({ "TL-MAC-001": "2026-10-10T09:00:00.000Z" });
    expect(parseGuidedMemory({ version: 1, accepted: { "/etc/passwd": "2026-10-10T09:00:00.000Z" } }).accepted).toEqual({});
    expect(parseGuidedMemory({ version: 1, accepted: { "TL-MAC-001": "not a date" } }).accepted).toEqual({});
    expect(parseGuidedMemory({ version: 1, accepted: ["TL-MAC-001"] }).accepted).toEqual({});
    expect(parseGuidedMemory({ version: 1, accepted: "TL-MAC-001" }).accepted).toEqual({});
  });

  it("reads aiAskedAt as a date or null and never from a v0.3 value", () => {
    expect(EMPTY_GUIDED_MEMORY.aiAskedAt).toBeNull();
    expect(parseGuidedMemory({ version: 1 }).aiAskedAt).toBeNull();
    expect(parseGuidedMemory({ version: 1, aiAskedAt: "2026-10-16T09:00:00.000Z" }).aiAskedAt).toBe("2026-10-16T09:00:00.000Z");
    expect(parseGuidedMemory({ version: 1, aiAskedAt: 1760000000 }).aiAskedAt).toBeNull();
    expect(parseGuidedMemory({ version: 1, aiAskedAt: "" }).aiAskedAt).toBeNull();
  });
});

describe("aiAskedRecently", () => {
  const now = "2026-10-16T12:00:00.000Z";

  it("is false when never asked", () => {
    expect(aiAskedRecently(EMPTY_GUIDED_MEMORY, now)).toBe(false);
  });

  it("is true inside the 14 day window and false at or past it", () => {
    expect(AI_ASK_AGAIN_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(aiAskedRecently({ aiAskedAt: now }, now)).toBe(true);
    expect(aiAskedRecently({ aiAskedAt: "2026-10-03T12:00:00.000Z" }, now)).toBe(true);
    expect(aiAskedRecently({ aiAskedAt: "2026-10-02T12:00:00.000Z" }, now)).toBe(false);
    expect(aiAskedRecently({ aiAskedAt: "2026-01-01T00:00:00.000Z" }, now)).toBe(false);
  });

  it("treats an unparseable date as never asked", () => {
    expect(aiAskedRecently({ aiAskedAt: "soon" }, now)).toBe(false);
    expect(aiAskedRecently({ aiAskedAt: now }, "soon")).toBe(false);
  });
});

describe("aiAvailableRecently", () => {
  const now = "2026-10-16T12:00:00.000Z";

  it("is false with nothing stored or another provider", () => {
    expect(aiAvailableRecently(EMPTY_GUIDED_MEMORY, "chatgpt", now)).toBe(false);
    expect(aiAvailableRecently({ aiLastAvailable: { provider: "claude_plan", at: now } }, "chatgpt", now)).toBe(false);
  });

  it("is true inside the 7 day window and false at or past it", () => {
    expect(AI_LAST_AVAILABLE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(aiAvailableRecently({ aiLastAvailable: { provider: "chatgpt", at: now } }, "chatgpt", now)).toBe(true);
    expect(aiAvailableRecently({ aiLastAvailable: { provider: "chatgpt", at: "2026-10-10T12:00:00.000Z" } }, "chatgpt", now)).toBe(true);
    expect(aiAvailableRecently({ aiLastAvailable: { provider: "chatgpt", at: "2026-10-09T12:00:00.000Z" } }, "chatgpt", now)).toBe(false);
  });

  it("treats an unparseable date as never", () => {
    expect(aiAvailableRecently({ aiLastAvailable: { provider: "apple", at: "soon" } }, "apple", now)).toBe(false);
    expect(aiAvailableRecently({ aiLastAvailable: { provider: "apple", at: now } }, "apple", "soon")).toBe(false);
  });
});
