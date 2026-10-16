import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EMPTY_GUIDED_MEMORY } from "@talos/core";
import { GUIDED_STORAGE_KEY, daysAfter, hoursAfter, loadGuidedMemory, saveGuidedMemory } from "./memory";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("guided memory storage", () => {
  it("round-trips through localStorage and falls back on damage", () => {
    expect(loadGuidedMemory()).toEqual(EMPTY_GUIDED_MEMORY);
    const memory = { ...EMPTY_GUIDED_MEMORY, snoozed: { "TL-MAC-002": "2026-10-23T00:00:00.000Z" }, laterCount: { "TL-MAC-002": 1 } };
    saveGuidedMemory(memory);
    expect(loadGuidedMemory()).toEqual(memory);
    localStorage.setItem(GUIDED_STORAGE_KEY, "{not json");
    expect(loadGuidedMemory()).toEqual(EMPTY_GUIDED_MEMORY);
  });

  it("computes snooze dates", () => {
    expect(daysAfter("2026-10-16T10:00:00.000Z", 7)).toBe("2026-10-23T10:00:00.000Z");
    expect(hoursAfter("2026-10-16T10:00:00.000Z", 24)).toBe("2026-10-17T10:00:00.000Z");
  });
});
