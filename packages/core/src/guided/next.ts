import type { RuleId, Severity } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { Rule } from "../domain/rule";
import { MACOS_CATALOG } from "../rules/macos/index";
import type { GuidedPlan, GuidedStep } from "./plan";
import { convertedShowStep } from "./plan";

/** What the end screen's "Do this next" button does: run a fix, open a pane, open the paywall, or open the finding. */
export type NextActionKind = "fix" | "show" | "unlock" | "details";

export interface NextAction {
  readonly ruleId: RuleId;
  readonly severity: Severity;
  readonly kind: NextActionKind;
  /** The step to reopen; null for "details", which has nothing to run. */
  readonly step: GuidedStep | null;
}

const RULES_BY_ID = new Map<RuleId, Rule>(MACOS_CATALOG.rules.map((rule) => [rule.id, rule]));

/** The plan's own step for the rule, or a single fix cut from the batch it sat in. */
function existingStep(plan: GuidedPlan, ruleId: RuleId): GuidedStep | null {
  for (const step of plan.steps) {
    if ((step.kind === "fix" || step.kind === "show") && step.ruleId === ruleId) {
      return step;
    }
    if (step.kind === "batch" && step.ruleIds.includes(ruleId)) {
      return { id: `fix:${ruleId}`, kind: "fix", ruleId, choice: { kind: "none" }, passphrase: false };
    }
  }
  return null;
}

/** A step for a rule that never had one: an in-app fix with no choice to make, else the pane to open. */
function freshStep(rule: Rule): GuidedStep | null {
  const apply = rule.fix.apply;
  if (apply.kind === "in_app" && (apply.choice === "none" || apply.choice === "all_ssh_keys")) {
    return { id: `fix:${rule.id}`, kind: "fix", ruleId: rule.id, choice: { kind: "none" }, passphrase: apply.passphrase };
  }
  return convertedShowStep(rule.id);
}

/** A rule the person chose to leave alone is only raised again when it is critical or high. */
function worthRaising(ruleId: RuleId): boolean {
  const severity = RULES_BY_ID.get(ruleId)?.severity;
  return severity === "critical" || severity === "high";
}

/**
 * The one thing to do next after a check-up: among the rules still waiting, locked or left alone (critical
 * and high only), the one with the most points; ties go to catalogue order. Null when nothing qualifies.
 */
export function nextAction(plan: GuidedPlan, report: ScanReport): NextAction | null {
  const candidates = new Set<RuleId>([...plan.later, ...plan.locked, ...plan.leftAlone.filter(worthRaising)]);
  let best: { ruleId: RuleId; points: number } | null = null;
  for (const result of report.results) {
    if (result.status !== "fail" || !candidates.has(result.ruleId)) {
      continue;
    }
    if (best === null || result.points > best.points) {
      best = { ruleId: result.ruleId, points: result.points };
    }
  }
  if (best === null) {
    return null;
  }
  const rule = RULES_BY_ID.get(best.ruleId);
  if (rule === undefined) {
    return null;
  }
  if (plan.locked.includes(rule.id)) {
    const paywall: GuidedStep = plan.steps.find((s) => s.kind === "paywall") ?? { id: "paywall", kind: "paywall", lockedRuleIds: plan.locked };
    return { ruleId: rule.id, severity: rule.severity, kind: "unlock", step: paywall };
  }
  const step = existingStep(plan, rule.id) ?? freshStep(rule);
  if (step === null) {
    return { ruleId: rule.id, severity: rule.severity, kind: "details", step: null };
  }
  return { ruleId: rule.id, severity: rule.severity, kind: step.kind === "show" ? "show" : "fix", step };
}
