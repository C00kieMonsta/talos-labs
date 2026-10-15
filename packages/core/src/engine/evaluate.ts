import { CORE_VERSION } from "../version";
import type { Evidence, Finding, RuleResult } from "../domain/finding";
import type { ScanReport, SectionSummary } from "../domain/report";
import type { Rule, RuleCatalog, RuleContext, RuleOutcome } from "../domain/rule";
import { SECTION_KEYS, type SectionKey, type SystemState } from "../domain/system-state";
import { headlineFor } from "./headline";
import { reportIdFor } from "./report-id";
import { computeScore, pointsFor } from "./score";

/** Keeps declared keys only and downgrades enum values outside the vocabulary to text. */
export function sanitiseEvidence(rule: Rule, evidence: readonly Evidence[]): readonly Evidence[] {
  const declared = new Set(rule.evidenceKeys);
  const out: Evidence[] = [];
  for (const entry of evidence) {
    if (!declared.has(entry.key)) {
      continue;
    }
    if (entry.value.kind === "enum") {
      const allowed = rule.evidenceVocabulary[entry.key] ?? [];
      if (!allowed.includes(entry.value.value)) {
        out.push({ ...entry, value: { kind: "text", value: entry.value.value } });
        continue;
      }
    }
    out.push(entry);
  }
  return out;
}

/** Evaluates one rule through the full engine path. Exported for tests and single-rule rechecks. */
export function evaluateRule(rule: Rule, state: SystemState, ctx: RuleContext): RuleResult {
  if (!rule.os.includes(ctx.os)) {
    return { ruleId: rule.id, status: "not_applicable", evidence: [], unknownReason: null, points: 0 };
  }
  for (const key of rule.requires) {
    const sec = state.sections[key];
    if (sec.status !== "ok") {
      return { ruleId: rule.id, status: "unknown", evidence: [], unknownReason: sec.reason, points: 0 };
    }
  }
  let outcome: RuleOutcome;
  try {
    outcome = rule.evaluate(state, ctx);
  } catch {
    return { ruleId: rule.id, status: "unknown", evidence: [], unknownReason: "rule_error", points: 0 };
  }
  const evidence = sanitiseEvidence(rule, outcome.evidence);
  if (outcome.status === "unknown") {
    return { ruleId: rule.id, status: "unknown", evidence, unknownReason: outcome.reason, points: 0 };
  }
  return {
    ruleId: rule.id,
    status: outcome.status,
    evidence,
    unknownReason: null,
    points: pointsFor(rule, outcome.status),
  };
}

function toFinding(rule: Rule, result: RuleResult, status: Finding["status"]): Finding {
  return {
    ruleId: rule.id,
    title: rule.title,
    headline: headlineFor(rule, status),
    severity: rule.severity,
    category: rule.category,
    cis: rule.cis,
    requires: rule.requires,
    status,
    evidence: result.evidence,
    unknownReason: result.unknownReason,
    points: result.points,
    explanation: rule.explanation,
    fix: rule.fix,
  };
}

function summariseSections(state: SystemState): Readonly<Record<SectionKey, SectionSummary>> {
  const out = {} as Record<SectionKey, SectionSummary>;
  for (const key of SECTION_KEYS) {
    const sec = state.sections[key];
    out[key] = sec.status === "ok" ? { status: "ok" } : { status: "unavailable", reason: sec.reason };
  }
  return out;
}

export function evaluate(state: SystemState, catalog: RuleCatalog, ctx: RuleContext): ScanReport {
  const results: RuleResult[] = [];
  const findings: Finding[] = [];
  for (const rule of catalog.rules) {
    const result = evaluateRule(rule, state, ctx);
    results.push(result);
    if (result.status === "fail" || result.status === "review" || result.status === "unknown") {
      findings.push(toFinding(rule, result, result.status));
    }
  }
  const score = computeScore(catalog.rules, results);
  const reportId = reportIdFor([
    state.collectedAt,
    ctx.now,
    CORE_VERSION,
    catalog.version,
    results.map((r) => `${r.ruleId}:${r.status}:${r.unknownReason ?? ""}`).join(","),
  ]);
  return {
    schemaVersion: 1,
    reportId,
    scannedAt: ctx.now,
    collectedAt: state.collectedAt,
    coreVersion: CORE_VERSION,
    catalogVersion: catalog.version,
    cisEdition: catalog.cisEdition,
    platform: state.host,
    sections: summariseSections(state),
    score,
    results,
    findings,
  };
}
