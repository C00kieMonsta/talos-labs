import { describe, expect, it } from "vitest";
import type { GuidedPlan, GuidedStep, ScanReport } from "@talos/core";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, MACOS_CATALOG, buildGuidedPlan, evaluate, freeFixRuleIds } from "@talos/core";
import { mergePlan, planCounts, planText, ruleIdsOf, withoutAccepted } from "./plan";

const NOW = "2026-10-16T10:00:00.000Z";
const PROFILE = { role: "individual" as const, technical: "low" as const, handlesClientData: false, laptopLeavesHome: true };
const report: ScanReport = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });

function plan(licensed: boolean): GuidedPlan {
  return buildGuidedPlan(report, { freeFixes: freeFixRuleIds(report), licensed }, PROFILE, EMPTY_GUIDED_MEMORY, NOW);
}

describe("plan helpers", () => {
  it("counts rules, not steps, for the plan sentences", () => {
    expect(planCounts(plan(false))).toEqual({ total: 3, forYou: 1, showWhere: 2 });
    expect(planText(plan(false), false)).toEqual({ title: "I found 3 things to fix.", body: "I can fix 1 of them for you now. The other 2 I'll show you where." });
    expect(planText(plan(false), true).body).toBe("Same 3 things as last time.");
    expect(planCounts(plan(true))).toEqual({ total: 7, forYou: 4, showWhere: 3 });
    expect(planText(plan(true), false).title).toBe("I found 7 things to fix.");
  });

  it("says what follows when only a permission or paywall step is left", () => {
    const only: GuidedPlan = { ...plan(false), steps: plan(false).steps.filter((s) => s.kind === "permission") };
    expect(planText(only, false).title).toBe("I found nothing to fix myself.");
  });

  it("keeps passed steps, merges fresh ones and appends extras without moving the person", () => {
    const old = plan(true);
    const batch = old.steps[0] as Extract<GuidedStep, { kind: "batch" }>;
    expect(batch.kind).toBe("batch");
    const extra: GuidedStep = { id: "show:TL-MAC-002", kind: "show", ruleId: "TL-MAC-002", pane: "firewall", watch: ["firewall"], watchEvery: 3000, restart: false, question: null };
    const merged = mergePlan({ old, index: 1, pinCurrent: false, fresh: old, report, extras: [extra], leftAlone: new Set(["TL-MAC-022"]) });
    expect(merged.steps[0]).toBe(batch);
    expect(merged.steps.map((s) => s.id)).not.toContain("fix:TL-MAC-022:/Users/alice/Public");
    expect(merged.steps[merged.steps.length - 1]).toEqual(extra);
    expect(merged.leftAlone).toContain("TL-MAC-022");
    expect(merged.freeFixes).toEqual(old.freeFixes);
  });

  it("drops an extra step and a left-alone rule the person chose to leave, so neither is proposed or listed twice", () => {
    const old = plan(true);
    const extra: GuidedStep = { id: "show:TL-MAC-002", kind: "show", ruleId: "TL-MAC-002", pane: "firewall", watch: ["firewall"], watchEvery: 3000, restart: false, question: null };
    const fresh: GuidedPlan = { ...old, accepted: ["TL-MAC-002", "TL-MAC-022"], steps: old.steps.filter((s) => !ruleIdsOf(s).includes("TL-MAC-002")) };
    const merged = mergePlan({ old, index: 0, pinCurrent: false, fresh, report, extras: [extra], leftAlone: new Set(["TL-MAC-022", "TL-MAC-014"]) });
    expect(merged.steps.map((s) => s.id)).not.toContain("show:TL-MAC-002");
    expect(merged.leftAlone).not.toContain("TL-MAC-022");
    expect(merged.leftAlone).toContain("TL-MAC-014");
    expect(merged.accepted).toEqual(["TL-MAC-002", "TL-MAC-022"]);
  });

  it("withoutAccepted shrinks a batch, converts one left to a single fix, and drops a step whose rule is accepted", () => {
    const batch = plan(true).steps[0] as Extract<GuidedStep, { kind: "batch" }>;
    expect(batch.ruleIds).toEqual(["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"]);
    expect(withoutAccepted(batch, [])).toBe(batch);
    expect(withoutAccepted(batch, ["TL-MAC-003"])).toEqual({ ...batch, ruleIds: ["TL-MAC-002", "TL-MAC-011"] });
    expect(withoutAccepted(batch, ["TL-MAC-003", "TL-MAC-011"])).toMatchObject({ id: "fix:TL-MAC-002", kind: "fix", ruleId: "TL-MAC-002" });
    expect(withoutAccepted(batch, ["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"])).toBeNull();
    const show: GuidedStep = { id: "show:TL-MAC-001", kind: "show", ruleId: "TL-MAC-001", pane: "filevault", watch: ["diskEncryption"], watchEvery: 3000, restart: false, question: null };
    expect(withoutAccepted(show, ["TL-MAC-001"])).toBeNull();
    expect(withoutAccepted(show, ["TL-MAC-002"])).toBe(show);
    const paywall: GuidedStep = { id: "paywall", kind: "paywall", lockedRuleIds: ["TL-MAC-022"] };
    expect(withoutAccepted(paywall, ["TL-MAC-022"])).toBe(paywall);
  });

  it("turns a batch left with one rule into a single fix step", () => {
    const old = plan(true);
    const extras: GuidedStep[] = [
      { id: "show:TL-MAC-002", kind: "show", ruleId: "TL-MAC-002", pane: "firewall", watch: ["firewall"], watchEvery: 3000, restart: false, question: null },
      { id: "show:TL-MAC-003", kind: "show", ruleId: "TL-MAC-003", pane: "firewall", watch: ["firewall"], watchEvery: 3000, restart: false, question: null },
    ];
    const merged = mergePlan({ old, index: 0, pinCurrent: false, fresh: old, report, extras, leftAlone: new Set() });
    const first = merged.steps[0];
    expect(first?.kind).toBe("fix");
    expect(ruleIdsOf(first as GuidedStep)).toEqual(["TL-MAC-011"]);
  });
});
