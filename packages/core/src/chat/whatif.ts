import type { RuleId } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { RuleCatalog } from "../domain/rule";
import { MACOS_CATALOG } from "../rules/macos/index";

/** What leaving one failing rule costs: the risk sentence and the points, read from the report. Zero calls. */
export interface WhatIf {
  readonly ruleId: RuleId;
  readonly headline: string;
  /** guided.why: the first line of the card. */
  readonly why: string;
  /** result.points: what the score gains when fixed. */
  readonly points: number;
  /** True for a critical rule; the card adds its third line. */
  readonly critical: boolean;
}

/** null when the rule is not in the catalogue or its result is not a fail. */
export function whatIfFor(report: ScanReport, ruleId: RuleId, catalog: RuleCatalog = MACOS_CATALOG): WhatIf | null {
  const rule = catalog.rules.find((entry) => entry.id === ruleId);
  const result = report.results.find((entry) => entry.ruleId === ruleId);
  if (rule === undefined || result === undefined || result.status !== "fail") return null;
  return { ruleId, headline: rule.guided.headline, why: rule.guided.why, points: result.points, critical: rule.severity === "critical" };
}
