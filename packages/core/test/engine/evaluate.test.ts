import { describe, expect, it } from "vitest";
import type { Rule, RuleCatalog } from "../../src/domain/rule";
import { SECTION_KEYS } from "../../src/domain/system-state";
import { evaluate } from "../../src/engine/evaluate";
import { CRITICAL_CAP, gradeFor } from "../../src/engine/score";
import { ALL_UNAVAILABLE } from "../../src/fixtures/all-unavailable";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { WINDOWS_MINIMAL } from "../../src/fixtures/windows-minimal";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { TL_MAC_001 } from "../../src/rules/macos/tl-mac-001";
import { TL_MAC_002 } from "../../src/rules/macos/tl-mac-002";
import { TL_MAC_003 } from "../../src/rules/macos/tl-mac-003";
import { CORE_VERSION } from "../../src/version";
import { ctxFor } from "../helpers";

const run = (state: typeof DEV_MACHINE, catalog: RuleCatalog = MACOS_CATALOG) => evaluate(state, catalog, ctxFor(state));

function statusesOf(state: typeof DEV_MACHINE) {
  const report = run(state);
  const byStatus = new Map<string, string[]>();
  for (const result of report.results) {
    const list = byStatus.get(result.status) ?? [];
    list.push(result.ruleId.slice(-3));
    byStatus.set(result.status, list);
  }
  return { report, byStatus };
}

describe("evaluate on dev-machine", () => {
  const { report, byStatus } = statusesOf(DEV_MACHINE);

  it("matches the per-rule outcomes in RULES.md", () => {
    expect(byStatus.get("fail")).toEqual(["001", "002", "003", "010", "011", "014", "022", "026", "029"]);
    expect(byStatus.get("review")).toEqual(["017", "023", "025"]);
    expect(byStatus.get("unknown")).toEqual(["028"]);
    expect(byStatus.get("not_applicable")).toEqual(["027"]);
    expect(byStatus.get("pass")).toHaveLength(17);
  });

  it("deducts 62 and scores 38, at_risk, incomplete, not capped", () => {
    expect(report.score).toMatchObject({
      deducted: 62,
      value: 38,
      grade: "at_risk",
      cappedByCritical: false,
      complete: false,
      counts: { pass: 17, fail: 9, review: 3, unknown: 1, not_applicable: 1 },
    });
  });

  it("028 is unknown with needs_full_disk_access", () => {
    const result = report.results.find((r) => r.ruleId === "TL-MAC-028");
    expect(result?.status).toBe("unknown");
    expect(result?.unknownReason).toBe("needs_full_disk_access");
  });

  it("carries one finding per fail, review and unknown result with the catalog text attached", () => {
    expect(report.findings).toHaveLength(13);
    for (const finding of report.findings) {
      const rule = MACOS_CATALOG.rules.find((r) => r.id === finding.ruleId);
      expect(rule).toBeDefined();
      expect(finding.title).toBe(rule?.title);
      expect(finding.explanation).toBe(rule?.explanation);
      expect(finding.fix).toEqual(rule?.fix);
      expect(finding.requires).toEqual(rule?.requires);
      expect(["fail", "review", "unknown"]).toContain(finding.status);
    }
  });

  it("points equal the severity weight on fail and 0 otherwise", () => {
    for (const result of report.results) {
      const rule = MACOS_CATALOG.rules.find((r) => r.id === result.ruleId);
      const weight = { critical: 20, high: 8, medium: 4, low: 2, info: 0 }[rule?.severity ?? "info"];
      expect(result.points).toBe(result.status === "fail" ? weight : 0);
    }
  });

  it("fills the report header from the inputs", () => {
    expect(report.schemaVersion).toBe(1);
    expect(report.coreVersion).toBe(CORE_VERSION);
    expect(report.catalogVersion).toBe("0.1.0");
    expect(report.cisEdition).toBe("CIS Apple macOS 26 Tahoe Benchmark v1.0.0");
    expect(report.collectedAt).toBe(DEV_MACHINE.collectedAt);
    expect(report.scannedAt).toBe(ctxFor(DEV_MACHINE).now);
    expect(report.platform).toEqual(DEV_MACHINE.host);
    expect(Object.keys(report.sections)).toEqual([...SECTION_KEYS]);
    expect(report.sections.diskEncryption).toEqual({ status: "ok" });
  });

  it("snapshot of findings guards wording changes", () => {
    expect(report.findings).toMatchSnapshot();
  });
});

describe("evaluate on the other fixtures", () => {
  it("hardened scores 100, good, complete", () => {
    const { report, byStatus } = statusesOf(HARDENED);
    expect(byStatus.get("pass")).toHaveLength(31);
    expect(report.score).toMatchObject({ value: 100, grade: "good", deducted: 0, complete: true, cappedByCritical: false });
    expect(report.findings).toEqual([]);
  });

  it("all-unavailable gives null score, every rule unknown with its first requires reason", () => {
    const report = run(ALL_UNAVAILABLE);
    expect(report.score.value).toBeNull();
    expect(report.score.grade).toBeNull();
    expect(report.score.deducted).toBe(0);
    expect(report.score.complete).toBe(false);
    expect(report.score.counts.unknown).toBe(31);
    for (const result of report.results) {
      const rule = MACOS_CATALOG.rules.find((r) => r.id === result.ruleId);
      const first = rule?.requires[0];
      const section = first === undefined ? undefined : ALL_UNAVAILABLE.sections[first];
      expect(result.status).toBe("unknown");
      expect(result.unknownReason).toBe(section?.status === "unavailable" ? section.reason : "never");
      expect(result.evidence).toEqual([]);
    }
    for (const key of SECTION_KEYS) {
      expect(report.sections[key].status).toBe("unavailable");
    }
  });

  it("fresh-install gives indeterminate on 010 and the documented outcomes", () => {
    const { report, byStatus } = statusesOf(FRESH_INSTALL);
    expect(byStatus.get("unknown")).toEqual(["010"]);
    expect(report.results.find((r) => r.ruleId === "TL-MAC-010")?.unknownReason).toBe("indeterminate");
    expect(byStatus.get("fail")).toEqual(["001", "002", "003", "014", "026"]);
    expect(byStatus.get("review")).toEqual(["017"]);
    expect(byStatus.get("not_applicable")).toEqual(["027", "028", "029", "030"]);
    expect(report.score).toMatchObject({ deducted: 36, value: 59, grade: "poor", cappedByCritical: true, complete: false });
  });

  it("windows-minimal gives 31 not_applicable and a null score", () => {
    const report = run(WINDOWS_MINIMAL);
    expect(report.score.counts.not_applicable).toBe(31);
    expect(report.score.value).toBeNull();
    expect(report.score.complete).toBe(true);
    expect(report.findings).toEqual([]);
  });
});

describe("engine mechanics", () => {
  it("results are in catalog order and ids match the catalog", () => {
    const report = run(DEV_MACHINE);
    expect(report.results.map((r) => r.ruleId)).toEqual(MACOS_CATALOG.rules.map((r) => r.id));
  });

  it("gives identical output on two runs", () => {
    const a = run(DEV_MACHINE);
    const b = run(DEV_MACHINE);
    expect(b).toEqual(a);
    expect(b.reportId).toBe(a.reportId);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("changes reportId when the input changes", () => {
    expect(run(DEV_MACHINE).reportId).not.toBe(run(HARDENED).reportId);
  });

  it("a throwing rule becomes unknown with rule_error and the run continues", () => {
    const thrower: Rule = {
      ...TL_MAC_002,
      id: "TL-MAC-900",
      evaluate() {
        throw new Error("boom");
      },
    };
    const catalog: RuleCatalog = { ...MACOS_CATALOG, rules: [TL_MAC_001, thrower, TL_MAC_002] };
    const report = run(HARDENED, catalog);
    expect(report.results.map((r) => r.status)).toEqual(["pass", "unknown", "pass"]);
    expect(report.results[1]?.unknownReason).toBe("rule_error");
    expect(report.score.complete).toBe(false);
    expect(report.findings.map((f) => f.ruleId)).toEqual(["TL-MAC-900"]);
  });

  it("a critical fail alone caps the score at 59", () => {
    const catalog: RuleCatalog = { ...MACOS_CATALOG, rules: [TL_MAC_001, TL_MAC_002] };
    const report = run({ ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } }, catalog);
    expect(report.score.deducted).toBe(20);
    expect(report.score.value).toBe(CRITICAL_CAP);
    expect(report.score.cappedByCritical).toBe(true);
    expect(report.score.grade).toBe("poor");
  });

  it("the cap does not report as binding when the value is already below it", () => {
    const report = run(DEV_MACHINE);
    expect(report.score.value).toBeLessThan(CRITICAL_CAP);
    expect(report.score.cappedByCritical).toBe(false);
  });

  it("downgrades out-of-vocabulary enum evidence to text and drops undeclared keys", () => {
    const smuggler: Rule = {
      ...TL_MAC_001,
      id: "TL-MAC-901",
      evidenceKeys: ["method", "flag"],
      evidenceVocabulary: { method: ["filevault"] },
      evaluate() {
        return {
          status: "fail",
          evidence: [
            { key: "method", label: "Method", value: { kind: "enum", value: "rm -rf /" } },
            { key: "flag", label: "Flag", value: { kind: "bool", value: true } },
            { key: "processName", label: "Smuggled", value: { kind: "enum", value: "x" } },
          ],
        };
      },
    };
    const catalog: RuleCatalog = { ...MACOS_CATALOG, rules: [smuggler] };
    const report = run(HARDENED, catalog);
    expect(report.results[0]?.evidence).toEqual([
      { key: "method", label: "Method", value: { kind: "text", value: "rm -rf /" } },
      { key: "flag", label: "Flag", value: { kind: "bool", value: true } },
    ]);
  });

  it("returns not_applicable without calling evaluate on another OS", () => {
    let called = false;
    const spy: Rule = {
      ...TL_MAC_001,
      evaluate() {
        called = true;
        return { status: "pass", evidence: [] };
      },
    };
    const report = evaluate(HARDENED, { ...MACOS_CATALOG, rules: [spy] }, { now: "2026-10-15T10:00:00.000Z", os: "windows" });
    expect(called).toBe(false);
    expect(report.results[0]?.status).toBe("not_applicable");
  });

  it("returns unknown without calling evaluate when a required section is unavailable", () => {
    let called = false;
    const spy: Rule = {
      ...TL_MAC_001,
      evaluate() {
        called = true;
        return { status: "pass", evidence: [] };
      },
    };
    evaluate(ALL_UNAVAILABLE, { ...MACOS_CATALOG, rules: [spy] }, ctxFor(ALL_UNAVAILABLE));
    expect(called).toBe(false);
  });

  it("grade bands at the boundaries", () => {
    const bands: Array<[number, string]> = [[100, "good"], [90, "good"], [89, "fair"], [70, "fair"], [69, "poor"], [40, "poor"], [39, "at_risk"], [0, "at_risk"]];
    for (const [value, grade] of bands) {
      expect(gradeFor(value), String(value)).toBe(grade);
    }
  });

  it("grade follows the deducted value through the engine", () => {
    const lowFail: Rule = { ...TL_MAC_003, severity: "low", evaluate: () => ({ status: "fail", evidence: [] }) };
    const runs: Array<[number, number, string]> = [[5, 90, "good"], [15, 70, "fair"], [30, 40, "poor"], [31, 38, "at_risk"], [60, 0, "at_risk"]];
    for (const [count, value, grade] of runs) {
      const rules = Array.from({ length: count }, (_, i) => ({ ...lowFail, id: `TL-MAC-${String(900 + i)}` as Rule["id"] }));
      const report = run(HARDENED, { ...MACOS_CATALOG, rules });
      expect(report.score.value, String(count)).toBe(value);
      expect(report.score.grade, String(count)).toBe(grade);
    }
  });
});
