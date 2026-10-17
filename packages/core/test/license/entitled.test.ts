import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { entitled, freeFixRuleIds } from "../../src/license/entitled";
import type { Feature, LicenseState } from "../../src/ports/license-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor } from "../helpers";

const FEATURES: readonly Feature[] = ["all_fixes", "recheck", "watch"];

describe("entitled", () => {
  const valid: LicenseState = {
    status: "valid",
    payload: { v: 1, lid: "x", product: "talos-desktop", plan: "personal", seats: 1, issuedAt: "2026-10-15", updatesUntil: "2027-10-15", tag: "00000000" },
  };
  const business: LicenseState = { ...valid, payload: { ...valid.payload, plan: "business", seats: 5 } };
  const states: readonly LicenseState[] = [
    { status: "none" },
    { status: "invalid", reason: "signature" },
    { status: "invalid", reason: "build_too_new" },
    { status: "invalid", reason: "revoked" },
    valid,
    business,
  ];

  it("matrix: every feature follows the valid status", () => {
    for (const state of states) {
      for (const feature of FEATURES) {
        expect(entitled(state, feature), `${state.status} ${feature}`).toBe(state.status === "valid");
      }
    }
  });

  it("explainer is no longer a feature", () => {
    // @ts-expect-error AI is free once connected (owner decision 2026-10-17).
    expect(entitled(valid, "explainer")).toBe(true);
  });
});

describe("freeFixRuleIds", () => {
  it("dev-machine: FileVault, then the two first 8-point failures in catalog order, plus every review", () => {
    const report = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
    expect(freeFixRuleIds(report)).toEqual(["TL-MAC-001", "TL-MAC-002", "TL-MAC-010", "TL-MAC-017", "TL-MAC-023", "TL-MAC-025"]);
  });

  it("fresh-install: breaks ties by catalog order and keeps review free", () => {
    const report = evaluate(FRESH_INSTALL, MACOS_CATALOG, ctxFor(FRESH_INSTALL));
    expect(freeFixRuleIds(report)).toEqual(["TL-MAC-001", "TL-MAC-002", "TL-MAC-026", "TL-MAC-017"]);
  });

  it("hardened: nothing to unlock", () => {
    expect(freeFixRuleIds(evaluate(HARDENED, MACOS_CATALOG, ctxFor(HARDENED)))).toEqual([]);
  });

  it("a failing left-alone rule never takes a free slot; a failing 032 behaves as any medium rule", () => {
    const base = evaluate(HARDENED, MACOS_CATALOG, ctxFor(HARDENED));
    const withFails = (ids: readonly string[], points: number) => ({
      ...base,
      findings: ids.map((ruleId) => ({ ...base.findings[0], ruleId: ruleId as never, status: "fail" as const, points, title: "", headline: "", severity: "medium" as const, category: "platform" as const, cis: null, requires: [], evidence: [], unknownReason: null, explanation: "", fix: MACOS_CATALOG.rules[0]!.fix, guided: MACOS_CATALOG.rules[0]!.guided })),
    });
    // 035 and 036 fail with the most points of all and still take no slot; 032 takes one as any medium rule would.
    expect(freeFixRuleIds(withFails(["TL-MAC-035", "TL-MAC-036", "TL-MAC-032", "TL-MAC-003"], 4))).toEqual(["TL-MAC-032", "TL-MAC-003"]);
    expect(freeFixRuleIds(withFails(["TL-MAC-035", "TL-MAC-036"], 4))).toEqual([]);
    expect(freeFixRuleIds(withFails(["TL-MAC-032", "TL-MAC-034", "TL-MAC-003", "TL-MAC-011"], 4))).toEqual(["TL-MAC-032", "TL-MAC-034", "TL-MAC-003"]);
  });

  it("never lists unknown findings and never exceeds three failing ids", () => {
    const report = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
    const free = freeFixRuleIds(report);
    const failing = free.filter((id) => report.findings.find((f) => f.ruleId === id)?.status === "fail");
    expect(failing).toHaveLength(3);
    expect(free).not.toContain("TL-MAC-028");
  });
});
