import type { RuleId } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { GuidedMemory } from "../guided/memory";
import { LATER_ASK_COUNT, type GuidedGate, type GuidedPlan, type GuidedStep } from "../guided/plan";
import type { SignalId } from "../ports/watch-port";
import type { AllowedInput } from "./input";
import { CHAT_LIMITS } from "../explainer/limits";
import type { ChatIntent, IntentKind } from "./intents";

// Flip when WatchPort gains investigate() and closeWatch() (DESIGN-AGENT part B, Rust and watch-port pass).
export const WATCH_AGENT_PORTS_READY = false;

/** The validator's record: AllowedInput plus the two drop-lists for relatedRuleIds. */
export interface Allowed extends AllowedInput {
  /** plan.accepted */
  readonly accepted: readonly RuleId[];
  /** plan.later */
  readonly snoozed: readonly RuleId[];
}

/** Core stays free of the desktop's scan and watch types: the caller passes the two booleans. */
export interface AllowedSource {
  readonly plan: GuidedPlan;
  readonly report: ScanReport;
  readonly gate: GuidedGate;
  /** scan.kind === "ready" on the desktop. fix, show and batch are empty otherwise. */
  readonly scanReady: boolean;
  /** watchActive(settings, gate) on the desktop; open_watch is in kinds only when true. */
  readonly watchEnabled: boolean;
  readonly memory: Pick<GuidedMemory, "laterCount" | "accepted">;
  /** Step ids already passed this check-up (fixed, snoozed, left alone), so they are never "undone". */
  readonly doneStepIds: readonly string[];
  /** The live watch items' ids (watchState.items.map((i) => i.signalId) on the desktop); treated as empty when absent. */
  readonly watchItems?: readonly SignalId[];
}

/** The allow-list each rule-taking kind is checked against. investigate is checked on its own (a signal id or a details id). */
export const ALLOWED_LIST_FOR: Readonly<Partial<Record<IntentKind, keyof AllowedInput>>> = {
  fix_rule: "fix",
  show_where: "show",
  explain_rule: "explain",
  open_details: "details",
  snooze_rule: "snooze",
  accept_rule: "accept",
  remind_rule: "remind",
  what_if: "whatIf",
};

const ALWAYS_KINDS: readonly IntentKind[] = ["explain_rule", "open_details", "show_list", "rescan", "change_ai", "snooze_rule", "accept_rule"];
const AGENT_ALWAYS_KINDS: readonly IntentKind[] = ["remind_rule", "write_up", "what_if"];

function unique<T>(ids: readonly T[]): T[] {
  return [...new Set(ids)];
}

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

/** Pure. DESIGN-CHAT "The allow-lists" plus DESIGN-AGENT's three lists; the watch kinds wait on portsReady. */
export function buildAllowed(source: AllowedSource, portsReady: boolean = WATCH_AGENT_PORTS_READY): Allowed {
  const { plan, report, scanReady, watchEnabled, memory } = source;
  const done = new Set(source.doneStepIds);
  // Nothing accepted, snoozed or left alone may reach an action list, whatever the steps say.
  const barred = new Set<RuleId>([...plan.accepted, ...plan.later, ...plan.leftAlone]);
  const undone = plan.steps.filter((step) => !done.has(step.id) && (step.kind === "batch" || step.kind === "fix" || step.kind === "show"));
  const idsOf = (kind: GuidedStep["kind"]): RuleId[] =>
    unique(undone.filter((step) => step.kind === kind).flatMap(stepRuleIds).filter((id) => !barred.has(id)));
  const explain = unique(undone.flatMap(stepRuleIds).filter((id) => !barred.has(id)));
  const accepted = new Set(Object.keys(memory.accepted));
  const snooze = explain.filter((id) => (memory.laterCount[id] ?? 0) < LATER_ASK_COUNT);
  const watchAgent = portsReady && watchEnabled;
  const kinds: IntentKind[] = [];
  if (scanReady) kinds.push("fix_rule", "fix_batch", "show_where");
  kinds.push(...ALWAYS_KINDS);
  if (watchEnabled) kinds.push("open_watch");
  if (watchAgent) kinds.push("investigate", "close_watch");
  kinds.push(...AGENT_ALWAYS_KINDS);
  return {
    fix: scanReady ? idsOf("fix") : [],
    batch: scanReady ? idsOf("batch") : [],
    show: scanReady ? idsOf("show") : [],
    explain,
    details: unique(report.results.map((result) => result.ruleId)),
    snooze,
    accept: unique([...explain, ...plan.later]).filter((id) => !accepted.has(id)),
    investigate: watchAgent ? unique(source.watchItems ?? []) : [],
    remind: unique([...snooze, ...plan.later]).filter((id) => !accepted.has(id)),
    whatIf: unique(report.results.filter((result) => result.status === "fail").map((result) => result.ruleId)),
    kinds,
    accepted: plan.accepted,
    snoozed: plan.later,
  };
}

/** The serialised half of Allowed: everything but accepted and snoozed. */
export function toAllowedInput(allowed: Allowed): AllowedInput {
  const { fix, batch, show, explain, details, snooze, accept, investigate, remind, whatIf, kinds } = allowed;
  return { fix, batch, show, explain, details, snooze, accept, investigate, remind, whatIf, kinds };
}

/** gate.licensed ? [] : plan.locked. Passed to validateChat, never serialised. */
export function lockedFor(plan: GuidedPlan, gate: GuidedGate): readonly RuleId[] {
  return gate.licensed ? [] : plan.locked;
}

/**
 * The related-row preference, used by the UI for every provider's relatedRuleIds. Per id: fix_rule when in allowed.fix, else show_where when in
 * allowed.show, else open_details when in allowed.details; at most CHAT_LIMITS.maxIntents, in allowed order
 * (every fix first, then the shows, then the details, each list in its own order). Accepted and snoozed ids are dropped.
 */
export function cardsFromRelated(relatedRuleIds: readonly RuleId[], allowed: Allowed): readonly ChatIntent[] {
  const wanted = new Set(relatedRuleIds);
  const dropped = new Set<RuleId>([...allowed.accepted, ...allowed.snoozed]);
  const seen = new Set<RuleId>();
  const out: ChatIntent[] = [];
  const lists: readonly [IntentKind, readonly RuleId[]][] = [
    ["fix_rule", allowed.fix],
    ["show_where", allowed.show],
    ["open_details", allowed.details],
  ];
  for (const [kind, ids] of lists) {
    if (!allowed.kinds.includes(kind)) continue;
    for (const ruleId of ids) {
      if (out.length >= CHAT_LIMITS.maxIntents) return out;
      if (!wanted.has(ruleId) || seen.has(ruleId) || dropped.has(ruleId)) continue;
      seen.add(ruleId);
      out.push({ kind, ruleId });
    }
  }
  return out;
}

/** The validated intents only: a turn the model pointed nowhere gets no card; relatedRuleIds become rows in the UI, never a live card. */
export function intentsFor(result: { readonly intents: readonly ChatIntent[] }, _allowed?: Allowed): readonly ChatIntent[] {
  return result.intents;
}

/**
 * True when the intent's kind is in allowed.kinds and its id is still in its list; the batch needs a non-empty
 * allowed.batch; investigate needs its signal in allowed.investigate or its rule in allowed.details.
 */
export function stillAllowed(intent: ChatIntent, allowed: Allowed): boolean {
  if (!allowed.kinds.includes(intent.kind)) return false;
  if (intent.kind === "fix_batch") return allowed.batch.length > 0;
  if (intent.kind === "investigate") {
    if (typeof intent.signalId === "string") return allowed.investigate.includes(intent.signalId);
    return intent.ruleId !== null && allowed.details.includes(intent.ruleId);
  }
  const list = ALLOWED_LIST_FOR[intent.kind];
  if (list === undefined) return true;
  return intent.ruleId !== null && (allowed[list] as readonly RuleId[]).includes(intent.ruleId);
}
