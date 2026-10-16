import { describe, expect, it } from "vitest";
import { EMPTY_GUIDED_MEMORY, parseGuidedMemory } from "../../src/guided/memory";

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
    });
    expect(parsed).toEqual({
      version: 1,
      snoozed: { "TL-MAC-002": "2026-10-22T10:00:00.000Z" },
      laterCount: { "TL-MAC-013": 1 },
      waiting: {},
      pendingRestart: ["TL-MAC-001"],
      paywallSnoozedUntil: null,
      permissionAskedAt: { full_disk_access: "2026-10-15T10:00:00.000Z" },
    });
  });
});
