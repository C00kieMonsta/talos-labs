import type { Evidence, Finding } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { Rule, RuleCatalog } from "../domain/rule";
import {
  EXPLAINER_LIMITS,
  SAFE_STRING_PATTERN,
  type ExplainerContext,
  type ExplainerFinding,
  type ExplainerProfile,
  type SafeEvidence,
} from "../ports/explainer-port";

/** Placeholder when the collected OS version does not pass the pattern. */
export const UNKNOWN_OS_VERSION = "unknown";

function safeValue(entry: Evidence, rule: Rule): SafeEvidence | null {
  const { key, value } = entry;
  if (!SAFE_STRING_PATTERN.test(key) || !rule.evidenceKeys.includes(key)) {
    return null;
  }
  switch (value.kind) {
    case "bool":
      return { key, value: value.value };
    case "number":
      return Number.isFinite(value.value) ? { key, value: value.value } : null;
    case "enum": {
      const allowed = rule.evidenceVocabulary[key] ?? [];
      if (!allowed.includes(value.value) || !SAFE_STRING_PATTERN.test(value.value)) {
        return null;
      }
      return { key, value: value.value };
    }
    case "version":
      return SAFE_STRING_PATTERN.test(value.value) ? { key, value: value.value } : null;
    case "path":
    case "text":
      return null;
  }
}

function safeEvidence(finding: Finding, rule: Rule | undefined): readonly SafeEvidence[] {
  if (rule === undefined) {
    return [];
  }
  const out: SafeEvidence[] = [];
  for (const entry of finding.evidence) {
    const safe = safeValue(entry, rule);
    if (safe !== null) {
      out.push(safe);
      if (out.length >= EXPLAINER_LIMITS.maxEvidencePerFinding) {
        break;
      }
    }
  }
  return out;
}

/** Finding ids the explainer may see, in report order, after the cap. */
export function explainerEligibleRuleIds(report: ScanReport): readonly Finding["ruleId"][] {
  return report.findings
    .filter((finding) => SAFE_STRING_PATTERN.test(finding.ruleId))
    .slice(0, EXPLAINER_LIMITS.maxFindings)
    .map((finding) => finding.ruleId);
}

/** The single chokepoint between a report and the model. Nothing machine-originated survives it. */
export function toExplainerContext(
  report: ScanReport,
  catalog: RuleCatalog,
  profile: ExplainerProfile,
): ExplainerContext {
  const rulesById = new Map(catalog.rules.map((rule) => [rule.id, rule] as const));
  const findings: ExplainerFinding[] = [];
  for (const finding of report.findings) {
    if (!SAFE_STRING_PATTERN.test(finding.ruleId)) {
      continue;
    }
    if (findings.length >= EXPLAINER_LIMITS.maxFindings) {
      break;
    }
    findings.push({
      ruleId: finding.ruleId,
      status: finding.status,
      severity: finding.severity,
      category: finding.category,
      points: finding.points,
      evidence: safeEvidence(finding, rulesById.get(finding.ruleId)),
    });
  }
  const osVersion = SAFE_STRING_PATTERN.test(report.platform.osVersion)
    ? report.platform.osVersion
    : UNKNOWN_OS_VERSION;
  return {
    schemaVersion: 1,
    os: report.platform.os,
    osVersion,
    profile: {
      role: profile.role,
      technical: profile.technical,
      handlesClientData: profile.handlesClientData,
      laptopLeavesHome: profile.laptopLeavesHome,
    },
    score: report.score.value,
    counts: { ...report.score.counts },
    findings,
  };
}
