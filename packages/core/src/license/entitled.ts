import type { RuleId } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import { LEFT_ALONE } from "../guided/plan";
import type { Feature, LicenseState } from "../ports/license-port";

export const FREE_FIX_COUNT = 3;

/** Any valid licence unlocks every feature: all_fixes, recheck and watch. plan and seats are informational in v0.1. */
export function entitled(state: LicenseState, feature: Feature): boolean {
  void feature;
  return state.status === "valid";
}

/**
 * Rule ids whose fix is free without a licence: the three failing findings
 * worth the most points (ties by catalog order) plus every review finding,
 * which is always free and takes no slot. A LEFT_ALONE rule is never a step,
 * so it never takes a slot either.
 */
export function freeFixRuleIds(report: ScanReport): readonly RuleId[] {
  const failing = report.findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => finding.status === "fail" && !LEFT_ALONE.includes(finding.ruleId))
    .sort((a, b) => b.finding.points - a.finding.points || a.index - b.index)
    .slice(0, FREE_FIX_COUNT)
    .map(({ finding }) => finding.ruleId);
  const review = report.findings.filter((finding) => finding.status === "review").map((finding) => finding.ruleId);
  return [...failing, ...review];
}
