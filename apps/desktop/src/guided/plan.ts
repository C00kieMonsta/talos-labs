import type { Finding, GuidedPlan, GuidedStep, GuidedStrings, RuleId, ScanReport } from "@talos/core";
import { MACOS_CATALOG } from "@talos/core";

/** The guided strings of a rule, from the catalog, so a rule that just passed can still be named. */
export function guidedFor(ruleId: RuleId): GuidedStrings {
  const rule = MACOS_CATALOG.rules.find((r) => r.id === ruleId);
  if (rule === undefined) throw new Error(`unknown rule ${ruleId}`);
  return rule.guided;
}

/** A finding's pane from the catalog, for a rule that may have left the report. */
export function paneFor(ruleId: RuleId) {
  return MACOS_CATALOG.rules.find((r) => r.id === ruleId)?.fix.settingsPane ?? null;
}
import { rulePasses } from "../scan/machine";

/** The rules a step acts on; permission and paywall steps act on none. */
export function ruleIdsOf(step: GuidedStep): readonly RuleId[] {
  switch (step.kind) {
    case "batch":
      return step.ruleIds;
    case "fix":
    case "show":
      return [step.ruleId];
    case "permission":
    case "paywall":
      return [];
  }
}

export function findingFor(report: ScanReport, ruleId: RuleId): Finding | null {
  return report.findings.find((f) => f.ruleId === ruleId) ?? null;
}

/** A batch left with one rule becomes a single fix step through the v0.2 path. */
function singleFromBatch(ruleId: RuleId): GuidedStep {
  return { id: `fix:${ruleId}`, kind: "fix", ruleId, choice: { kind: "none" }, passphrase: false };
}

export interface MergeInput {
  readonly old: GuidedPlan;
  readonly index: number;
  /** True when the current step is in flight or done and must stay in place. */
  readonly pinCurrent: boolean;
  readonly fresh: GuidedPlan;
  readonly report: ScanReport;
  /** Converted show steps and the steps the paywall unlocked, kept while their rule still fails. */
  readonly extras: readonly GuidedStep[];
  /** Rules the person moved past without a fix; never a step again this check-up. */
  readonly leftAlone: ReadonlySet<RuleId>;
}

/**
 * Rebuilds the plan from a new report without moving the person: steps already passed stay as they were,
 * the fresh steps fill the rest, and the extras go last. The free set stays the one frozen on the old plan.
 */
export function mergePlan(input: MergeInput): GuidedPlan {
  const { old, index, pinCurrent, fresh, report, extras, leftAlone } = input;
  const passed = old.steps.slice(0, index);
  const current = old.steps[index];
  const pinned = pinCurrent && current !== undefined ? [current] : [];
  const taken = new Set<string>([...passed, ...pinned].map((s) => s.id));
  const takenRules = new Set<RuleId>([...passed, ...pinned].flatMap(ruleIdsOf));
  const liveExtras = extras.filter((e) => !taken.has(e.id) && ruleIdsOf(e).every((r) => !rulePasses(report, r)));
  for (const e of liveExtras) for (const r of ruleIdsOf(e)) takenRules.add(r);
  const dropRule = (r: RuleId) => takenRules.has(r) || leftAlone.has(r);
  const rest: GuidedStep[] = [];
  for (const step of fresh.steps) {
    if (taken.has(step.id)) continue;
    if (step.kind === "batch") {
      const ruleIds = step.ruleIds.filter((r) => !dropRule(r));
      if (ruleIds.length === 0) continue;
      rest.push(ruleIds.length === 1 ? singleFromBatch(ruleIds[0] as RuleId) : { ...step, ruleIds });
      continue;
    }
    if ((step.kind === "fix" || step.kind === "show") && dropRule(step.ruleId)) continue;
    rest.push(step);
  }
  const extraLeftAlone = [...leftAlone].filter((r) => !rulePasses(report, r) && !fresh.leftAlone.includes(r));
  return {
    ...fresh,
    freeFixes: old.freeFixes,
    steps: [...passed, ...pinned, ...rest, ...liveExtras],
    leftAlone: [...fresh.leftAlone, ...extraLeftAlone],
  };
}

/** The counts behind the plan sentences: rules, not steps. */
export function planCounts(plan: GuidedPlan): { total: number; forYou: number; showWhere: number } {
  let forYou = 0;
  let showWhere = 0;
  for (const step of plan.steps) {
    if (step.kind === "batch" || step.kind === "fix") forYou += ruleIdsOf(step).length;
    else if (step.kind === "show") showWhere += 1;
  }
  return { total: forYou + showWhere, forYou, showWhere };
}

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

/** Headline and second sentence of the plan screen. */
export function planText(plan: GuidedPlan, sameAsLast: boolean): { title: string; body: string } {
  const { total, forYou, showWhere } = planCounts(plan);
  if (total === 0) {
    const next = plan.steps[0];
    const follow = next?.kind === "permission" ? "I'd like to check one more area." : next?.kind === "paywall" ? "There is more in the full version." : "";
    return { title: "I found nothing to fix myself.", body: follow };
  }
  const title = `I found ${things(total)} to fix.`;
  if (sameAsLast) return { title, body: `Same ${things(total)} as last time.` };
  if (forYou === 0) return { title, body: total === 1 ? "I'll show you where." : "They all need a quick visit to System Settings. I'll show you where." };
  if (showWhere === 0) return { title, body: forYou === 1 ? "I can fix it for you now." : "I can fix them all for you now." };
  const other = showWhere === 1 ? "The other one I'll show you where." : `The other ${showWhere} I'll show you where.`;
  return { title, body: `I can fix ${forYou === 1 ? "1" : forYou} of them for you now. ${other}` };
}
