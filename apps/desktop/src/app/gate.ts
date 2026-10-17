import type { Feature, Finding, LicenseState, RuleId, ScanReport } from "@talos/core";
import { entitled, freeFixRuleIds } from "@talos/core";

export interface Gate {
  readonly licensed: boolean;
  readonly freeFixes: readonly RuleId[];
  has(feature: Feature): boolean;
  /** true when the fix card must be hidden behind the lock. */
  fixLocked(finding: Pick<Finding, "ruleId" | "status">): boolean;
  /** true when explaining this rule is paid: the free explanations follow the free fixes. */
  explainLocked(ruleId: RuleId): boolean;
}

export function buildGate(report: ScanReport | null, license: LicenseState): Gate {
  const freeFixes = report === null ? [] : freeFixRuleIds(report);
  const has = (feature: Feature): boolean => entitled(license, feature);
  return {
    licensed: license.status === "valid",
    freeFixes,
    has,
    fixLocked(finding) {
      if (has("all_fixes")) return false;
      if (finding.status === "review") return false;
      return !freeFixes.includes(finding.ruleId);
    },
    explainLocked(ruleId) {
      return !has("explainer") && !freeFixes.includes(ruleId);
    },
  };
}
