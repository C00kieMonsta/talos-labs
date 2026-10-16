import { describe, expect, it } from "vitest";
import type { GuidedPlan, GuidedStep, ScanReport } from "@talos/core";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, MACOS_CATALOG, buildGuidedPlan, evaluate, freeFixRuleIds } from "@talos/core";
import { mergePlan, planCounts, planText, ruleIdsOf } from "./plan";

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
