import { SEVERITY_WEIGHT, type RuleResult, type RuleStatus } from "../domain/finding";
import type { Grade, Score } from "../domain/report";
import type { Rule } from "../domain/rule";

export const CRITICAL_CAP = 59;

export function gradeFor(value: number): Grade {
  if (value >= 90) {
    return "good";
  }
  if (value >= 70) {
    return "fair";
  }
  if (value >= 40) {
    return "poor";
  }
  return "at_risk";
}

export function pointsFor(rule: Rule, status: RuleStatus): number {
  return status === "fail" ? SEVERITY_WEIGHT[rule.severity] : 0;
}

export function computeScore(rules: readonly Rule[], results: readonly RuleResult[]): Score {
  const counts: Record<RuleStatus, number> = {
    pass: 0,
    fail: 0,
    review: 0,
    unknown: 0,
    not_applicable: 0,
  };
  // Results are matched to rules by id, so their order does not matter.
  const severityById = new Map(rules.map((rule) => [rule.id, rule.severity]));
  let deducted = 0;
  let criticalFailed = false;
  for (const result of results) {
    counts[result.status] += 1;
    if (result.status === "fail") {
      deducted += result.points;
      if (severityById.get(result.ruleId) === "critical") {
        criticalFailed = true;
      }
    }
  }

  const evaluable = counts.pass + counts.fail + counts.review;
  if (evaluable === 0) {
    return {
      value: null,
      grade: null,
      deducted,
      cappedByCritical: false,
      complete: counts.unknown === 0,
      counts,
    };
  }

  const uncapped = Math.max(0, 100 - deducted);
  const cappedByCritical = criticalFailed && uncapped > CRITICAL_CAP;
  const value = cappedByCritical ? CRITICAL_CAP : uncapped;
  return {
    value,
    grade: gradeFor(value),
    deducted,
    cappedByCritical,
    complete: counts.unknown === 0,
    counts,
  };
}
