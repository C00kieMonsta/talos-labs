import type { RuleId } from "../domain/finding";
import type { Grade, ScanReport } from "../domain/report";
import type { Rule, RuleCatalog } from "../domain/rule";
import { containsMachineText } from "../explainer/prose";
import type { AiProviderId } from "../guided/memory";
import type { GuidedPlan, GuidedStep } from "../guided/plan";
import { MACOS_CATALOG } from "../rules/macos/index";

export type WriteUpWatch = "calm" | "look" | "act";

/** The validated plan brief, when one exists for this plan; the desktop reads it from last-brief.json. */
export interface WriteUpBrief {
  readonly summary: string;
  readonly provider: AiProviderId;
}

export interface WriteUpInput {
  readonly plan: GuidedPlan;
  readonly report: ScanReport;
  /** Ids that pass now, computed by the caller with rulePasses. */
  readonly fixed: readonly RuleId[];
  /** The watch's state word key, null when the watch is not active. */
  readonly watch: WriteUpWatch | null;
  readonly brief: WriteUpBrief | null;
  /** Already formatted for the reader, never an ISO string. */
  readonly date: string;
}

/** Every string the text needs, passed in so core holds no copy. Templates use {date}, {n} and {grade}. */
export interface WriteUpStrings {
  readonly title: string;
  readonly score: string;
  readonly fixed: string;
  readonly todo: string;
  readonly later: string;
  readonly left: string;
  readonly watch: string;
  readonly watchWords: Readonly<Record<WriteUpWatch, string>>;
  readonly grade: Readonly<Record<Grade, string>>;
  /** The provider's quote prefix, or null when no brief may be quoted. */
  readonly quote: string | null;
}

export interface WriteUpText {
  readonly text: string;
  /** Lines containsMachineText refused; 0 on the catalogue as shipped. */
  readonly dropped: number;
}

/** The catalogue's "Done. " prefix on every guided.done. */
export const DONE_PREFIX = "Done. ";

const INDENT = "  ";

function stepRuleIds(step: GuidedStep): readonly RuleId[] {
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

function withoutDone(done: string): string {
  return done.startsWith(DONE_PREFIX) ? done.slice(DONE_PREFIX.length) : done;
}

/**
 * Pure. Authored text from the catalogue's guided headline, why and done strings, the score, the plan's lists and the
 * watch word; never guided.where, never a path, a label, a port or a rule id. A line containsMachineText refuses is dropped and counted.
 */
export function buildWriteUp(input: WriteUpInput, strings: WriteUpStrings, catalog: RuleCatalog = MACOS_CATALOG): WriteUpText {
  const rules = new Map<RuleId, Rule>(catalog.rules.map((rule) => [rule.id, rule]));
  const fixed = new Set<RuleId>(input.fixed);
  const lines: string[] = [];
  let dropped = 0;
  const push = (line: string): void => {
    if (containsMachineText(line)) dropped += 1;
    else lines.push(line);
  };
  const section = (label: string, items: readonly string[]): void => {
    if (items.length === 0) return;
    push(label);
    for (const item of items) push(`${INDENT}${item}`);
  };
  const guidedOf = (ids: readonly RuleId[], pick: (rule: Rule) => string): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      const rule = rules.get(id);
      if (rule !== undefined) out.push(pick(rule));
    }
    return out;
  };

  push(strings.title.replace("{date}", input.date));
  const { value, grade } = input.report.score;
  if (value !== null && grade !== null) push(strings.score.replace("{n}", String(value)).replace("{grade}", strings.grade[grade]));

  const undone = [...new Set(input.plan.steps.flatMap(stepRuleIds))].filter((id) => !fixed.has(id));
  section(strings.fixed, guidedOf(input.fixed, (rule) => withoutDone(rule.guided.done)));
  section(strings.todo, guidedOf(undone, (rule) => `${rule.guided.headline}. ${rule.guided.why}`));
  section(strings.later, guidedOf(input.plan.later, (rule) => rule.guided.headline));
  section(strings.left, guidedOf(input.plan.accepted, (rule) => rule.guided.headline));
  if (input.watch !== null) push(`${strings.watch} ${strings.watchWords[input.watch]}`);
  if (input.brief !== null && strings.quote !== null) push(`${strings.quote} "${input.brief.summary}"`);

  return { text: lines.join("\n"), dropped };
}
