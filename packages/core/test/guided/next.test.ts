import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { EMPTY_GUIDED_MEMORY } from "../../src/guided/memory";
import { nextAction } from "../../src/guided/next";
import { buildGuidedPlan } from "../../src/guided/plan";
import type { GuidedPlan } from "../../src/guided/plan";
import { freeFixRuleIds } from "../../src/license/entitled";
import type { ExplainerProfile } from "../../src/ports/explainer-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor, NOW } from "../helpers";

const PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };
const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const BASE = buildGuidedPlan(DEV, { freeFixes: freeFixRuleIds(DEV), licensed: false }, PROFILE, EMPTY_GUIDED_MEMORY, NOW);

function plan(overrides: Partial<GuidedPlan>): GuidedPlan {
  return { ...BASE, ...overrides };
}

describe("nextAction", () => {
  it("is null when nothing is waiting, locked or left alone", () => {
    expect(nextAction(plan({ later: [], locked: [], leftAlone: [] }), DEV)).toBeNull();
    // Technical rules are never the next thing.
    expect(nextAction(plan({ later: [], locked: [], leftAlone: [], technical: ["TL-MAC-029"] }), DEV)).toBeNull();
  });

  it("picks the most points across the three lists and reopens the plan's own show step", () => {
    const next = nextAction(plan({ later: ["TL-MAC-010", "TL-MAC-001"] }), DEV);
    expect(next?.ruleId).toBe("TL-MAC-001");
    expect(next?.severity).toBe("critical");
    expect(next?.kind).toBe("show");
    expect(next?.step).toBe(BASE.steps[1]);
  });

  it("breaks a points tie by catalogue order", () => {
    // 010 and the locked rules are all high; 010 comes first in the catalogue.
    const next = nextAction(plan({ later: ["TL-MAC-010"] }), DEV);
    expect(next?.ruleId).toBe("TL-MAC-010");
    const locked = nextAction(plan({ later: [], locked: ["TL-MAC-022", "TL-MAC-003"] }), DEV);
    expect(locked?.ruleId).toBe("TL-MAC-022");
  });

  it("unlocks through the plan's paywall step, or a fresh one when the paywall was snoozed", () => {
    const withPaywall = nextAction(plan({ later: [] }), DEV);
    expect(withPaywall?.kind).toBe("unlock");
    expect(withPaywall?.step).toBe(BASE.steps[4]);
    const snoozed = nextAction(plan({ later: [], steps: BASE.steps.filter((s) => s.kind !== "paywall") }), DEV);
    expect(snoozed?.kind).toBe("unlock");
    expect(snoozed?.step).toEqual({ id: "paywall", kind: "paywall", lockedRuleIds: BASE.locked });
  });

  it("cuts a single fix from a batch and builds a fresh step for a rule that never had one", () => {
    const batched = plan({ later: ["TL-MAC-002"], locked: [], steps: [{ id: "batch", kind: "batch", ruleIds: ["TL-MAC-002", "TL-MAC-003"] }] });
    expect(nextAction(batched, DEV)?.step).toEqual({ id: "fix:TL-MAC-002", kind: "fix", ruleId: "TL-MAC-002", choice: { kind: "none" }, passphrase: false });
    const fresh = nextAction(plan({ later: ["TL-MAC-002"], locked: [], steps: [] }), DEV);
    expect(fresh?.kind).toBe("fix");
    expect(fresh?.step?.id).toBe("fix:TL-MAC-002");
    // 001 is critical, left alone and a deep link: a show step with its pane.
    const alone = nextAction(plan({ later: [], locked: [], leftAlone: ["TL-MAC-001"], steps: [] }), DEV);
    expect(alone?.kind).toBe("show");
    expect(alone?.step?.kind === "show" && alone.step.pane).toBe("filevault");
  });

  it("does not raise a low or medium rule the person chose to leave alone", () => {
    // 014 is low: leaving it alone is respected, so the end screen has nothing to push.
    expect(nextAction(plan({ later: [], locked: [], leftAlone: ["TL-MAC-014"] }), DEV)).toBeNull();
    // A high rule left alone still comes back as the next thing.
    expect(nextAction(plan({ later: [], locked: [], leftAlone: ["TL-MAC-014", "TL-MAC-010"] }), DEV)?.ruleId).toBe("TL-MAC-010");
  });

  it("never picks an accepted rule, even the one with the most points", () => {
    const AT = "2026-10-10T09:00:00.000Z";
    const licensed = { freeFixes: freeFixRuleIds(DEV), licensed: true };
    // 001 is accepted and still failing; 010 is snoozed. The card is 010.
    const withLater = buildGuidedPlan(DEV, licensed, PROFILE, { ...EMPTY_GUIDED_MEMORY, accepted: { "TL-MAC-001": AT }, snoozed: { "TL-MAC-010": "2026-10-22T10:00:00.000Z" } }, NOW);
    expect(withLater.accepted).toEqual(["TL-MAC-001"]);
    expect(withLater.later).toEqual(["TL-MAC-010"]);
    expect(nextAction(withLater, DEV)?.ruleId).toBe("TL-MAC-010");
    // Only 001 accepted, nothing waiting or locked, 014 left alone is low: nothing to push.
    const onlyAccepted = buildGuidedPlan(DEV, licensed, PROFILE, { ...EMPTY_GUIDED_MEMORY, accepted: { "TL-MAC-001": AT } }, NOW);
    expect(onlyAccepted.leftAlone).toEqual(["TL-MAC-014"]);
    expect(nextAction(onlyAccepted, DEV)).toBeNull();
  });

  it("falls back to details for a rule with neither a fix nor a pane", () => {
    // 005 is manual and fails on the dev machine only when forced; the list is what matters here.
    const result = DEV.results.find((r) => r.ruleId === "TL-MAC-005");
    const forced = { ...DEV, results: DEV.results.map((r) => (r.ruleId === "TL-MAC-005" ? { ...r, status: "fail" as const, points: 20 } : r)) };
    expect(result).toBeDefined();
    const next = nextAction(plan({ later: [], locked: [], leftAlone: ["TL-MAC-005"] }), forced);
    expect(next?.kind).toBe("details");
    expect(next?.step).toBeNull();
  });
});
