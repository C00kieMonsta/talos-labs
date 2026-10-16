import { describe, expect, it } from "vitest";
import type { ScanReport } from "../../src/domain/report";
import { evaluate } from "../../src/engine/evaluate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { EMPTY_GUIDED_MEMORY, type GuidedMemory } from "../../src/guided/memory";
import { buildGuidedPlan, convertedShowStep, planLocked, WATCH_EVERY_MS } from "../../src/guided/plan";
import { freeFixRuleIds } from "../../src/license/entitled";
import type { ExplainerProfile } from "../../src/ports/explainer-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor, NOW } from "../helpers";

const PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };
const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const LICENSED = { freeFixes: freeFixRuleIds(DEV), licensed: true };
const FREE = { freeFixes: freeFixRuleIds(DEV), licensed: false };

function daysFrom(now: string, days: number): string {
  return new Date(Date.parse(now) + days * 24 * 60 * 60 * 1000).toISOString();
}

function ids(memory: GuidedMemory, licensed = true): string[] {
  return buildGuidedPlan(DEV, licensed ? LICENSED : FREE, PROFILE, memory, NOW).steps.map((s) => s.id);
}

describe("buildGuidedPlan and memory", () => {
  it("a snoozed rule is absent and listed under later", () => {
    const memory = { ...EMPTY_GUIDED_MEMORY, snoozed: { "TL-MAC-001": daysFrom(NOW, 7) } };
    expect(ids(memory)).not.toContain("show:TL-MAC-001");
    expect(buildGuidedPlan(DEV, LICENSED, PROFILE, memory, NOW).later).toEqual(["TL-MAC-001"]);
  });

  it("an expired snooze is a step again", () => {
    const memory = { ...EMPTY_GUIDED_MEMORY, snoozed: { "TL-MAC-001": daysFrom(NOW, -1) } };
    expect(ids(memory)).toContain("show:TL-MAC-001");
  });

  it("a thrice-Latered rule is absent; twice is still a step", () => {
    expect(ids({ ...EMPTY_GUIDED_MEMORY, laterCount: { "TL-MAC-010": 3 } })).not.toContain("show:TL-MAC-010");
    expect(ids({ ...EMPTY_GUIDED_MEMORY, laterCount: { "TL-MAC-010": 2 } })).toContain("show:TL-MAC-010");
  });

  it("a waiting rule is absent", () => {
    const memory = { ...EMPTY_GUIDED_MEMORY, waiting: { "TL-MAC-026": daysFrom(NOW, 1) } };
    expect(ids(memory)).not.toContain("show:TL-MAC-026");
  });

  it("a snoozed batch member shrinks the batch; one left converts to a single fix", () => {
    const one = { ...EMPTY_GUIDED_MEMORY, snoozed: { "TL-MAC-003": daysFrom(NOW, 7) } };
    const plan = buildGuidedPlan(DEV, LICENSED, PROFILE, one, NOW);
    expect(plan.steps[0]).toEqual({ id: "batch", kind: "batch", ruleIds: ["TL-MAC-002", "TL-MAC-011"] });
    const two = { ...one, snoozed: { ...one.snoozed, "TL-MAC-011": daysFrom(NOW, 7) } };
    expect(buildGuidedPlan(DEV, LICENSED, PROFILE, two, NOW).steps[0]).toEqual({
      id: "fix:TL-MAC-002",
      kind: "fix",
      ruleId: "TL-MAC-002",
      choice: { kind: "none" },
      passphrase: false,
    });
  });

  it("a paywall snooze removes the paywall step and keeps locked", () => {
    const memory = { ...EMPTY_GUIDED_MEMORY, paywallSnoozedUntil: daysFrom(NOW, 14) };
    const plan = buildGuidedPlan(DEV, FREE, PROFILE, memory, NOW);
    expect(plan.steps.map((s) => s.id)).not.toContain("paywall");
    expect(plan.locked).toEqual(["TL-MAC-003", "TL-MAC-011", "TL-MAC-022", "TL-MAC-026"]);
    const expired = { ...EMPTY_GUIDED_MEMORY, paywallSnoozedUntil: daysFrom(NOW, -1) };
    expect(ids(expired, false)).toContain("paywall");
  });

  it("permissionAskedAt within 30 days removes the permission step", () => {
    const recent = { ...EMPTY_GUIDED_MEMORY, permissionAskedAt: { full_disk_access: daysFrom(NOW, -29) } };
    expect(ids(recent)).not.toContain("permission:full_disk_access");
    const old = { ...EMPTY_GUIDED_MEMORY, permissionAskedAt: { full_disk_access: daysFrom(NOW, -31) } };
    expect(ids(old)).toContain("permission:full_disk_access");
  });
});

describe("planLocked", () => {
  it("plans the unlocked rules by the same ordering", () => {
    const steps = planLocked(DEV, ["TL-MAC-003", "TL-MAC-011", "TL-MAC-022", "TL-MAC-026"], PROFILE, EMPTY_GUIDED_MEMORY, NOW);
    expect(steps.map((s) => s.id)).toEqual(["batch", "fix:TL-MAC-022:/Users/alice/Public", "show:TL-MAC-026"]);
    expect(steps[0]?.kind === "batch" && steps[0].ruleIds).toEqual(["TL-MAC-003", "TL-MAC-011"]);
  });

  it("ignores rules that are not failing or not eligible", () => {
    const memory = { ...EMPTY_GUIDED_MEMORY, snoozed: { "TL-MAC-026": daysFrom(NOW, 7) } };
    expect(planLocked(DEV, ["TL-MAC-026", "TL-MAC-015", "TL-MAC-014"], PROFILE, memory, NOW)).toEqual([]);
  });
});

describe("the frozen free set", () => {
  function withPassing(report: ScanReport, ruleId: string): ScanReport {
    return {
      ...report,
      results: report.results.map((r) => (r.ruleId === ruleId ? { ...r, status: "pass", points: 0, evidence: [] } : r)),
      findings: report.findings.filter((f) => f.ruleId !== ruleId),
    };
  }

  it("rebuilding with the plan's own free set never unlocks a new rule", () => {
    const plan = buildGuidedPlan(DEV, FREE, PROFILE, EMPTY_GUIDED_MEMORY, NOW);
    expect(plan.freeFixes).toEqual(["TL-MAC-001", "TL-MAC-002", "TL-MAC-010", "TL-MAC-017", "TL-MAC-023", "TL-MAC-025"]);
    const after = withPassing(DEV, "TL-MAC-002");
    const frozen = buildGuidedPlan(after, { freeFixes: plan.freeFixes, licensed: false }, PROFILE, EMPTY_GUIDED_MEMORY, NOW);
    expect(frozen.steps.filter((s) => s.kind === "fix" || s.kind === "batch")).toEqual([]);
    expect(frozen.locked).toEqual(["TL-MAC-003", "TL-MAC-011", "TL-MAC-022", "TL-MAC-026"]);
    // The drift this guards against: the live gate would make 022 free next.
    const live = buildGuidedPlan(after, { freeFixes: freeFixRuleIds(after), licensed: false }, PROFILE, EMPTY_GUIDED_MEMORY, NOW);
    expect(live.steps.map((s) => s.id)).toContain("fix:TL-MAC-022:/Users/alice/Public");
    expect(live.locked).toEqual(["TL-MAC-003", "TL-MAC-011", "TL-MAC-026"]);
  });
});

describe("convertedShowStep", () => {
  it("an in-app rule with a pane watches its recheck sections every 3 s", () => {
    expect(convertedShowStep("TL-MAC-002")).toEqual({
      id: "show:TL-MAC-002",
      kind: "show",
      ruleId: "TL-MAC-002",
      pane: "firewall",
      watch: ["firewall"],
      watchEvery: WATCH_EVERY_MS,
      restart: false,
      question: null,
    });
  });

  it("a deep link keeps its own pane and watch; a manual rule and an unknown id give null", () => {
    const step = convertedShowStep("TL-MAC-010");
    expect(step?.kind === "show" && [step.pane, step.restart, step.watchEvery]).toEqual(["software_update", true, 10000]);
    expect(convertedShowStep("TL-MAC-028")).toBeNull();
    expect(convertedShowStep("TL-MAC-999")).toBeNull();
  });
});
