import type { Feature, Finding, LicenseState, RuleId, ScanReport } from "@talos/core";
import { entitled, freeFixRuleIds } from "@talos/core";
import type { AppSettings } from "../settings";

export interface Gate {
  readonly licensed: boolean;
  readonly freeFixes: readonly RuleId[];
  has(feature: Feature): boolean;
  /** true when the fix card must be hidden behind the lock. */
  fixLocked(finding: Pick<Finding, "ruleId" | "status">): boolean;
  /** AI is free once connected (owner decision 2026-10-17); kept one release so callers compile, nothing reads it. */
  explainLocked(ruleId: RuleId): boolean;
  /** true while the menu bar watch is part of the full version the person does not hold. */
  readonly watchLocked: boolean;
}

/** The one predicate for every "watch on" string: the person's switch and the licence. */
export function watchActive(settings: Pick<AppSettings, "watch">, gate: Pick<Gate, "watchLocked">): boolean {
  return settings.watch.enabled && !gate.watchLocked;
}

export function buildGate(report: ScanReport | null, license: LicenseState): Gate {
  const freeFixes = report === null ? [] : freeFixRuleIds(report);
  const has = (feature: Feature): boolean => entitled(license, feature);
  const licensed = license.status === "valid";
  return {
    licensed,
    freeFixes,
    has,
    fixLocked(finding) {
      if (has("all_fixes")) return false;
      if (finding.status === "review") return false;
      return !freeFixes.includes(finding.ruleId);
    },
    explainLocked(ruleId) {
      void ruleId;
      return false;
    },
    watchLocked: !licensed,
  };
}
