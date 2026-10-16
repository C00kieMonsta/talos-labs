import { describe, expect, it } from "vitest";
import type { RuleId } from "../../src/domain/finding";
import type { ScanReport } from "../../src/domain/report";
import { evaluate } from "../../src/engine/evaluate";
import { ALL_UNAVAILABLE } from "../../src/fixtures/all-unavailable";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { EMPTY_GUIDED_MEMORY } from "../../src/guided/memory";
import { buildGuidedPlan } from "../../src/guided/plan";
import { freeFixRuleIds } from "../../src/license/entitled";
import type { ExplainerProfile } from "../../src/ports/explainer-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor, NOW } from "../helpers";

const PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };
const MEDIUM: ExplainerProfile = { ...PROFILE, technical: "medium" };
const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const HARD = evaluate(HARDENED, MACOS_CATALOG, ctxFor(HARDENED));
const UNAVAILABLE = evaluate(ALL_UNAVAILABLE, MACOS_CATALOG, ctxFor(ALL_UNAVAILABLE));
const LOCKED: RuleId[] = ["TL-MAC-003", "TL-MAC-011", "TL-MAC-022", "TL-MAC-026"];

function gateFor(report: ScanReport, licensed: boolean) {
  return { freeFixes: freeFixRuleIds(report), licensed };
}



describe("buildGuidedPlan on dev-machine", () => {
  it("unlicensed: one free fix, two restart shows, permission, paywall", () => {
    const plan = buildGuidedPlan(DEV, gateFor(DEV, false), PROFILE, EMPTY_GUIDED_MEMORY, NOW);
    expect(plan.steps.map((s) => s.id)).toEqual(["fix:TL-MAC-002", "show:TL-MAC-001", "show:TL-MAC-010", "permission:full_disk_access", "paywall"]);
    const paywall = plan.steps[4];
    expect(paywall?.kind === "paywall" && paywall.lockedRuleIds).toEqual(LOCKED);
    expect(plan.locked).toEqual(LOCKED);
    expect(plan.leftAlone).toEqual(["TL-MAC-014"]);
    expect(plan.worthALook).toEqual(["TL-MAC-017", "TL-MAC-023", "TL-MAC-025"]);
    expect(plan.technical).toEqual(["TL-MAC-029"]);
    expect(plan.later).toEqual([]);
    expect(plan.unreadable).toBe(1);
    expect(plan.reportId).toBe(DEV.reportId);
    const shows = plan.steps.filter((s) => s.kind === "show");
    expect(shows.map((s) => s.kind === "show" && s.restart)).toEqual([true, true]);
    const first = plan.steps[1];
    expect(first?.kind === "show" && [first.pane, first.watch, first.watchEvery]).toEqual(["filevault", ["diskEncryption"], 3000]);
  });

  it("licensed: batch, the share fix, the backup question, the restart shows, permission, no paywall", () => {
    const plan = buildGuidedPlan(DEV, gateFor(DEV, true), PROFILE, EMPTY_GUIDED_MEMORY, NOW);
    expect(plan.steps.map((s) => s.id)).toEqual([
      "batch",
      "fix:TL-MAC-022:/Users/alice/Public",
      "show:TL-MAC-026",
      "show:TL-MAC-001",
      "show:TL-MAC-010",
      "permission:full_disk_access",
    ]);
    const batch = plan.steps[0];
    expect(batch?.kind === "batch" && batch.ruleIds).toEqual(["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"]);
    const share = plan.steps[1];
    expect(share?.kind === "fix" && share.choice).toEqual({ kind: "share", path: "/Users/alice/Public" });
    const backup = plan.steps[2];
    expect(backup?.kind === "show" && backup.question).toBe("backup_disk");
    const permission = plan.steps[5];
    expect(permission?.kind === "permission" && permission.unlocks).toEqual(["TL-MAC-028"]);
    expect(plan.locked).toEqual([]);
    expect(plan.technical).toEqual(["TL-MAC-029"]);
  });

  it("licensed, technical medium: one fix step per unprotected key after 022", () => {
    const plan = buildGuidedPlan(DEV, gateFor(DEV, true), MEDIUM, EMPTY_GUIDED_MEMORY, NOW);
    expect(plan.steps.slice(1, 4).map((s) => s.id)).toEqual([
      "fix:TL-MAC-022:/Users/alice/Public",
      "fix:TL-MAC-029:/Users/alice/.ssh/id_ed25519",
      "fix:TL-MAC-029:/Users/alice/.ssh/aws-eu-west-1.pem",
    ]);
    const key = plan.steps[2];
    expect(key?.kind === "fix" && [key.choice, key.passphrase]).toEqual([{ kind: "ssh_key", path: "/Users/alice/.ssh/id_ed25519" }, true]);
    expect(plan.technical).toEqual([]);
  });
});

describe("buildGuidedPlan on the other fixtures", () => {
  it("hardened: no steps, nothing to list", () => {
    const plan = buildGuidedPlan(HARD, gateFor(HARD, false), PROFILE, EMPTY_GUIDED_MEMORY, NOW);
    expect(plan.steps).toEqual([]);
    expect([plan.leftAlone, plan.worthALook, plan.technical, plan.later, plan.locked]).toEqual([[], [], [], [], []]);
    expect(plan.unreadable).toBe(0);
  });

  it("all-unavailable: the permission step only, 31 unreadable", () => {
    const plan = buildGuidedPlan(UNAVAILABLE, gateFor(UNAVAILABLE, false), PROFILE, EMPTY_GUIDED_MEMORY, NOW);
    expect(plan.steps.map((s) => s.id)).toEqual(["permission:full_disk_access"]);
    expect(plan.unreadable).toBe(31);
  });
});
