import { describe, expect, it } from "vitest";
import type { ScanReport } from "../../src/domain/report";
import { evaluate } from "../../src/engine/evaluate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { acceptRules, acceptedFailing, clearAcceptedThatPass, isAccepted, unacceptRule } from "../../src/guided/accepted";
import { EMPTY_GUIDED_MEMORY, type GuidedMemory } from "../../src/guided/memory";
import { KEEP_ACCEPTED_THROUGH_PASS } from "../../src/guided/plan";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor, NOW } from "../helpers";

const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const AT = "2026-10-10T09:00:00.000Z";

function accepted(...ruleIds: string[]): GuidedMemory {
  return { ...EMPTY_GUIDED_MEMORY, accepted: Object.fromEntries(ruleIds.map((id) => [id, AT])) };
}

function withStatus(report: ScanReport, ruleId: string, status: "pass" | "fail" | "review" | "unknown" | "not_applicable"): ScanReport {
  return { ...report, results: report.results.map((r) => (r.ruleId === ruleId ? { ...r, status, points: status === "fail" ? r.points : 0 } : r)) };
}

describe("isAccepted", () => {
  it("reads the map by rule id", () => {
    expect(isAccepted(accepted("TL-MAC-001"), "TL-MAC-001")).toBe(true);
    expect(isAccepted(accepted("TL-MAC-001"), "TL-MAC-002")).toBe(false);
    expect(isAccepted(EMPTY_GUIDED_MEMORY, "TL-MAC-001")).toBe(false);
  });
});

describe("acceptedFailing", () => {
  it("lists only ids whose finding fails, in report order", () => {
    // 004 passes, 017 is review, 028 is unknown, 027 is not applicable on the dev machine.
    const memory = accepted("TL-MAC-010", "TL-MAC-004", "TL-MAC-017", "TL-MAC-028", "TL-MAC-027", "TL-MAC-001", "TL-MAC-999");
    expect(acceptedFailing(memory, DEV)).toEqual(["TL-MAC-001", "TL-MAC-010"]);
    expect(acceptedFailing(EMPTY_GUIDED_MEMORY, DEV)).toEqual([]);
  });
});

describe("acceptRules", () => {
  const before: GuidedMemory = {
    ...EMPTY_GUIDED_MEMORY,
    snoozed: { "TL-MAC-001": "2026-10-22T10:00:00.000Z", "TL-MAC-002": "2026-10-22T10:00:00.000Z" },
    laterCount: { "TL-MAC-001": 3, "TL-MAC-002": 1 },
    waiting: { "TL-MAC-001": "2026-10-16T10:00:00.000Z", "TL-MAC-026": "2026-10-16T10:00:00.000Z" },
    pendingRestart: ["TL-MAC-001"],
    paywallSnoozedUntil: "2026-10-29T10:00:00.000Z",
    permissionAskedAt: { full_disk_access: AT },
    aiAskedAt: AT,
    accepted: { "TL-MAC-014": AT },
    reminders: { "TL-MAC-001": "2026-10-16T08:00:00.000Z", "TL-MAC-002": "2026-10-19T08:00:00.000Z" },
  };

  it("writes the date and removes snoozed, laterCount, waiting and reminders for those ids only", () => {
    const after = acceptRules(before, ["TL-MAC-001"], NOW);
    expect(after).toEqual({
      ...before,
      snoozed: { "TL-MAC-002": "2026-10-22T10:00:00.000Z" },
      laterCount: { "TL-MAC-002": 1 },
      waiting: { "TL-MAC-026": "2026-10-16T10:00:00.000Z" },
      accepted: { "TL-MAC-014": AT, "TL-MAC-001": NOW },
      reminders: { "TL-MAC-002": "2026-10-19T08:00:00.000Z" },
    });
    expect(after.pendingRestart).toBe(before.pendingRestart);
    expect(after.permissionAskedAt).toBe(before.permissionAskedAt);
  });

  it("accepts several ids at once and keeps an earlier date for an id accepted again", () => {
    const after = acceptRules(before, ["TL-MAC-001", "TL-MAC-002", "TL-MAC-014"], NOW);
    expect(after.accepted).toEqual({ "TL-MAC-014": NOW, "TL-MAC-001": NOW, "TL-MAC-002": NOW });
    expect(after.snoozed).toEqual({});
    expect(after.laterCount).toEqual({});
    expect(after.waiting).toEqual({ "TL-MAC-026": "2026-10-16T10:00:00.000Z" });
    expect(after.reminders).toEqual({});
  });

  it("returns the same object for an empty list and never mutates the input", () => {
    expect(acceptRules(before, [], NOW)).toBe(before);
    acceptRules(before, ["TL-MAC-001"], NOW);
    expect(before.accepted).toEqual({ "TL-MAC-014": AT });
    expect(before.laterCount).toEqual({ "TL-MAC-001": 3, "TL-MAC-002": 1 });
  });
});

describe("unacceptRule", () => {
  it("removes only that id and nothing else", () => {
    const memory = { ...accepted("TL-MAC-001", "TL-MAC-002"), laterCount: { "TL-MAC-010": 2 } };
    const after = unacceptRule(memory, "TL-MAC-001");
    expect(after).toEqual({ ...memory, accepted: { "TL-MAC-002": AT } });
    expect(after.laterCount).toBe(memory.laterCount);
  });

  it("returns the same object when the id is absent", () => {
    const memory = accepted("TL-MAC-002");
    expect(unacceptRule(memory, "TL-MAC-001")).toBe(memory);
    expect(unacceptRule(EMPTY_GUIDED_MEMORY, "TL-MAC-001")).toBe(EMPTY_GUIDED_MEMORY);
  });
});

describe("clearAcceptedThatPass", () => {
  it("clears on pass and not_applicable", () => {
    const memory = accepted("TL-MAC-001", "TL-MAC-002");
    expect(clearAcceptedThatPass(memory, withStatus(DEV, "TL-MAC-001", "pass")).accepted).toEqual({ "TL-MAC-002": AT });
    expect(clearAcceptedThatPass(memory, withStatus(DEV, "TL-MAC-001", "not_applicable")).accepted).toEqual({ "TL-MAC-002": AT });
  });

  it("keeps on fail, review, unknown and a missing result", () => {
    const memory = accepted("TL-MAC-001", "TL-MAC-999");
    for (const status of ["fail", "review", "unknown"] as const) {
      expect(clearAcceptedThatPass(memory, withStatus(DEV, "TL-MAC-001", status)), status).toBe(memory);
    }
    const missing = { ...DEV, results: DEV.results.filter((r) => r.ruleId !== "TL-MAC-001") };
    expect(clearAcceptedThatPass(memory, missing)).toBe(memory);
  });

  it("keeps 027 and 010 through a pass", () => {
    expect(KEEP_ACCEPTED_THROUGH_PASS).toEqual(["TL-MAC-027", "TL-MAC-010"]);
    const memory = accepted("TL-MAC-027", "TL-MAC-010", "TL-MAC-001");
    const report = withStatus(withStatus(withStatus(DEV, "TL-MAC-027", "pass"), "TL-MAC-010", "pass"), "TL-MAC-001", "pass");
    expect(clearAcceptedThatPass(memory, report).accepted).toEqual({ "TL-MAC-027": AT, "TL-MAC-010": AT });
    // 027 is not applicable on the dev machine as it stands; still kept, same object.
    const only027 = accepted("TL-MAC-027");
    expect(clearAcceptedThatPass(only027, DEV)).toBe(only027);
  });

  it("returns the same object when nothing changes and touches no other field", () => {
    const memory = { ...accepted("TL-MAC-001"), laterCount: { "TL-MAC-010": 1 } };
    expect(clearAcceptedThatPass(memory, DEV)).toBe(memory);
    expect(clearAcceptedThatPass(EMPTY_GUIDED_MEMORY, withStatus(DEV, "TL-MAC-001", "pass"))).toBe(EMPTY_GUIDED_MEMORY);
    const cleared = clearAcceptedThatPass(memory, withStatus(DEV, "TL-MAC-001", "pass"));
    expect(cleared.accepted).toEqual({});
    expect(cleared.laterCount).toBe(memory.laterCount);
  });
});
