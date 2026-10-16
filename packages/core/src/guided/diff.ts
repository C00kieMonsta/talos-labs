import type { RuleId, RuleStatus } from "../domain/finding";
import type { ScanReport } from "../domain/report";

export interface ReportDiff {
  /** fail to pass or not_applicable, plus a pendingRestart rule that now passes. */
  readonly fixed: readonly RuleId[];
  /** pass, not_applicable or unknown to fail. */
  readonly appeared: readonly RuleId[];
  /** fail to unknown. */
  readonly unreadable: readonly RuleId[];
}

const EMPTY_DIFF: ReportDiff = { fixed: [], appeared: [], unreadable: [] };

function passes(status: RuleStatus): boolean {
  return status === "pass" || status === "not_applicable";
}

/** Compares results[].status per rule id, in the next report's order. Review changes are not announced. */
export function diffReports(previous: ScanReport | null, next: ScanReport, pendingRestart: readonly RuleId[]): ReportDiff {
  if (previous === null) {
    return EMPTY_DIFF;
  }
  const before = new Map<RuleId, RuleStatus>(previous.results.map((result) => [result.ruleId, result.status]));
  const restart = new Set(pendingRestart);
  const fixed: RuleId[] = [];
  const appeared: RuleId[] = [];
  const unreadable: RuleId[] = [];
  for (const result of next.results) {
    const was = before.get(result.ruleId);
    const now = result.status;
    if (passes(now) && (was === "fail" || restart.has(result.ruleId))) {
      fixed.push(result.ruleId);
    } else if (now === "fail" && was !== undefined && (passes(was) || was === "unknown")) {
      appeared.push(result.ruleId);
    } else if (now === "unknown" && was === "fail") {
      unreadable.push(result.ruleId);
    }
  }
  return { fixed, appeared, unreadable };
}
