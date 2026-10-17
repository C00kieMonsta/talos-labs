import { describe, expect, it } from "vitest";
import type { Finding } from "../../src/domain/finding";
import type { ScanReport } from "../../src/domain/report";
import { evaluate } from "../../src/engine/evaluate";
import { toExplainerContext, explainerEligibleRuleIds } from "../../src/explainer/context";
import { validatePrioritisation } from "../../src/explainer/validate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { EXPLAINER_LIMITS, SAFE_STRING_PATTERN } from "../../src/ports/explainer-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor } from "../helpers";
import { CANARY, CANARY_PROFILE as PROFILE, INJECT } from "../helpers/canary-state";

describe("toExplainerContext canary", () => {
  const report = evaluate(CANARY, MACOS_CATALOG, ctxFor(CANARY));
  const context = toExplainerContext(report, MACOS_CATALOG, PROFILE);
  const serialised = JSON.stringify(context);

  it("the canary fixture produces findings for every string-bearing rule", () => {
    const ids = report.findings.map((f) => f.ruleId);
    for (const id of ["TL-MAC-018", "TL-MAC-022", "TL-MAC-023", "TL-MAC-024", "TL-MAC-025", "TL-MAC-028", "TL-MAC-029", "TL-MAC-030", "TL-MAC-031"]) {
      expect(ids).toContain(id);
    }
    expect(JSON.stringify(report)).toContain(INJECT);
  });

  it("no injected string reaches the serialised context", () => {
    expect(serialised).not.toContain(INJECT);
    expect(serialised).not.toContain("IGNORE");
  });

  it("every key and string value matches SAFE_STRING_PATTERN", () => {
    expect(context.osVersion).toMatch(SAFE_STRING_PATTERN);
    expect(context.osVersion).toBe("unknown");
    for (const finding of context.findings) {
      expect(finding.ruleId).toMatch(SAFE_STRING_PATTERN);
      for (const entry of finding.evidence) {
        expect(entry.key).toMatch(SAFE_STRING_PATTERN);
        if (typeof entry.value === "string") {
          expect(entry.value).toMatch(SAFE_STRING_PATTERN);
        }
        expect(["boolean", "number", "string"]).toContain(typeof entry.value);
      }
    }
  });

  it("every finding carries exactly the known keys and accepted is a boolean, never a string", () => {
    for (const finding of context.findings) {
      expect(Object.keys(finding)).toEqual(["ruleId", "status", "severity", "category", "points", "evidence", "accepted"]);
      expect(typeof finding.accepted).toBe("boolean");
    }
  });

  it("keeps bool, number, enum and version and drops path and text", () => {
    const f031 = context.findings.find((f) => f.ruleId === "TL-MAC-031");
    expect(f031?.evidence).toEqual([
      { key: "hitCount", value: 1 },
      { key: "unreadableCount", value: 1 },
      { key: "pattern", value: "aws_access_key_id" },
      { key: "line", value: 3 },
    ]);
    const f006 = report.findings.find((f) => f.ruleId === "TL-MAC-006");
    expect(f006).toBeUndefined();
  });

  it("carries the profile, score and counts through unchanged", () => {
    expect(context.profile).toEqual(PROFILE);
    expect(context.score).toBe(report.score.value);
    expect(context.counts).toEqual(report.score.counts);
    expect(context.os).toBe("macos");
    expect(context.schemaVersion).toBe(1);
  });
});

describe("toExplainerContext on a clean report", () => {
  const report = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
  const context = toExplainerContext(report, MACOS_CATALOG, PROFILE);

  it("keeps a regex-valid OS version", () => {
    expect(context.osVersion).toBe("27.0.1");
  });

  it("lists every finding in report order with its status, severity, category and points", () => {
    expect(context.findings.map((f) => f.ruleId)).toEqual(report.findings.map((f) => f.ruleId));
    expect(context.findings.map((f) => f.ruleId)).toEqual([...explainerEligibleRuleIds(report)]);
    for (const [index, finding] of context.findings.entries()) {
      const source = report.findings[index];
      expect(finding.status).toBe(source?.status);
      expect(finding.severity).toBe(source?.severity);
      expect(finding.category).toBe(source?.category);
      expect(finding.points).toBe(source?.points);
    }
  });

  it("accepted is true for exactly the ids given and false otherwise", () => {
    expect(context.findings.every((f) => f.accepted === false)).toBe(true);
    const marked = toExplainerContext(report, MACOS_CATALOG, PROFILE, ["TL-MAC-001", "TL-MAC-999"]);
    expect(marked.findings.filter((f) => f.accepted).map((f) => f.ruleId)).toEqual(["TL-MAC-001"]);
    expect(marked.findings.map((f) => f.ruleId)).toEqual(context.findings.map((f) => f.ruleId));
    const one = marked.findings.find((f) => f.ruleId === "TL-MAC-001");
    const plain = context.findings.find((f) => f.ruleId === "TL-MAC-001");
    expect(one).toEqual({ ...plain, accepted: true });
  });

  it("explainerEligibleRuleIds drops the accepted ids, keeps the order, and the rest validates", () => {
    const all = explainerEligibleRuleIds(report);
    expect(all).toContain("TL-MAC-001");
    const eligible = explainerEligibleRuleIds(report, ["TL-MAC-001"]);
    expect(eligible).not.toContain("TL-MAC-001");
    expect(eligible).toEqual(all.filter((id) => id !== "TL-MAC-001"));
    const raw = { order: [...eligible].reverse(), reasons: [], startWith: eligible.slice(0, 1) };
    expect(validatePrioritisation(raw, report, eligible).ok).toBe(true);
    // An order that still names the accepted rule is not a permutation of the eligible set.
    expect(validatePrioritisation({ ...raw, order: [...all].reverse() }, report, eligible).ok).toBe(false);
  });

  it("keeps the version evidence of a passing enum", () => {
    const f028 = context.findings.find((f) => f.ruleId === "TL-MAC-028");
    expect(f028?.evidence).toEqual([
      { key: "browserCount", value: 2 },
      { key: "broadAccessCount", value: 0 },
      { key: "uncheckedBrowser", value: "chrome" },
    ]);
  });
});

describe("toExplainerContext key injection and caps", () => {
  const base = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
  const f022 = base.findings.find((f) => f.ruleId === "TL-MAC-022");
  if (f022 === undefined) {
    throw new Error("fixture changed");
  }

  function withFindings(findings: readonly Finding[]): ScanReport {
    return { ...base, findings };
  }

  it("drops evidence whose key is injected or undeclared, even with a safe bool value", () => {
    const poisoned: Finding = {
      ...f022,
      evidence: [
        { key: `${INJECT} key`, label: "x", value: { kind: "bool", value: true } },
        { key: "undeclaredButSafe", label: "x", value: { kind: "bool", value: true } },
        { key: "enabled", label: "x", value: { kind: "bool", value: true } },
      ],
    };
    const context = toExplainerContext(withFindings([poisoned]), MACOS_CATALOG, PROFILE);
    expect(context.findings[0]?.evidence).toEqual([{ key: "enabled", value: true }]);
    expect(JSON.stringify(context)).not.toContain("undeclaredButSafe");
    expect(JSON.stringify(context)).not.toContain(INJECT);
  });

  it("drops an enum value outside the vocabulary and a version that fails the pattern", () => {
    const poisoned: Finding = {
      ...f022,
      ruleId: "TL-MAC-006",
      evidence: [
        { key: "engine", label: "x", value: { kind: "enum", value: "xprotect" } },
        { key: "engine", label: "x", value: { kind: "enum", value: "rm" } },
        { key: "version", label: "x", value: { kind: "version", value: "5311" } },
        { key: "version", label: "x", value: { kind: "version", value: "5311; rm -rf /" } },
      ],
    };
    const context = toExplainerContext(withFindings([poisoned]), MACOS_CATALOG, PROFILE);
    expect(context.findings[0]?.evidence).toEqual([
      { key: "engine", value: "xprotect" },
      { key: "version", value: "5311" },
    ]);
  });

  it("gives empty evidence for a finding whose rule is not in the catalog", () => {
    const foreign: Finding = { ...f022, ruleId: "TL-MAC-999" };
    const context = toExplainerContext(withFindings([foreign]), MACOS_CATALOG, PROFILE);
    expect(context.findings).toHaveLength(1);
    expect(context.findings[0]?.evidence).toEqual([]);
  });

  it("caps findings at 60 and evidence at 8 per finding", () => {
    const many = Array.from({ length: 75 }, (_, i) => ({
      ...f022,
      evidence: Array.from({ length: 20 }, (_, j) => ({ key: "shareCount", label: "x", value: { kind: "number" as const, value: j, unit: null } })),
      ruleId: i === 0 ? f022.ruleId : (`TL-MAC-${String(100 + i)}` as Finding["ruleId"]),
    }));
    const context = toExplainerContext(withFindings(many), MACOS_CATALOG, PROFILE);
    expect(context.findings).toHaveLength(EXPLAINER_LIMITS.maxFindings);
    expect(context.findings[0]?.evidence).toHaveLength(EXPLAINER_LIMITS.maxEvidencePerFinding);
    expect(explainerEligibleRuleIds(withFindings(many))).toHaveLength(EXPLAINER_LIMITS.maxFindings);
  });

  it("drops a finding whose ruleId fails the pattern", () => {
    const bad: Finding = { ...f022, ruleId: `TL-MAC-${INJECT}` as Finding["ruleId"] };
    const context = toExplainerContext(withFindings([bad, f022]), MACOS_CATALOG, PROFILE);
    expect(context.findings.map((f) => f.ruleId)).toEqual(["TL-MAC-022"]);
  });
});
