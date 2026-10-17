import type { RuleId, RuleResult, SettingsPane } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { Rule } from "../domain/rule";
import type { SectionKey } from "../domain/system-state";
import type { ExplainerProfile } from "../ports/explainer-port";
import type { FixChoice } from "../ports/fix-port";
import { MACOS_CATALOG } from "../rules/macos/index";
import type { GuidedMemory } from "./memory";

/** Poll interval for a show step converted from a failed in-app fix. */
export const WATCH_EVERY_MS = 3000;

/** Never a step; listed under "Things I left alone" when failing. */
export const LEFT_ALONE: readonly RuleId[] = ["TL-MAC-005", "TL-MAC-014", "TL-MAC-017", "TL-MAC-018", "TL-MAC-024", "TL-MAC-028", "TL-MAC-031"];

/** The "Do this later" count at which the step asks whether to stop; "No, keep asking" resets it. */
export const LATER_ASK_COUNT = 3;

/** Rules that pass and fail on their own cycle; a pass does not clear their acceptance. */
export const KEEP_ACCEPTED_THROUGH_PASS: readonly RuleId[] = ["TL-MAC-027", "TL-MAC-010"];

const PERMISSION_ASK_MS = 30 * 24 * 60 * 60 * 1000;

export type GuidedStep =
  | { readonly id: "batch"; readonly kind: "batch"; readonly ruleIds: readonly RuleId[] }
  | { readonly id: string; readonly kind: "fix"; readonly ruleId: RuleId; readonly choice: FixChoice; readonly passphrase: boolean }
  | {
      readonly id: string;
      readonly kind: "show";
      readonly ruleId: RuleId;
      readonly pane: SettingsPane;
      readonly watch: readonly SectionKey[];
      /** Milliseconds. */
      readonly watchEvery: number;
      readonly restart: boolean;
      readonly question: "backup_disk" | null;
    }
  | { readonly id: "permission:full_disk_access"; readonly kind: "permission"; readonly permission: "full_disk_access"; readonly unlocks: readonly RuleId[] }
  | { readonly id: "paywall"; readonly kind: "paywall"; readonly lockedRuleIds: readonly RuleId[] };

export interface GuidedPlan {
  readonly reportId: string;
  /** gate.freeFixes as read when the check-up landed; rebuilds pass it back in place of the live gate. */
  readonly freeFixes: readonly RuleId[];
  readonly steps: readonly GuidedStep[];
  /** Rule ids per end-screen line. */
  readonly leftAlone: readonly RuleId[];
  readonly worthALook: readonly RuleId[];
  readonly technical: readonly RuleId[];
  readonly later: readonly RuleId[];
  readonly locked: readonly RuleId[];
  /** Failing rules the person chose to leave alone; never a step. */
  readonly accepted: readonly RuleId[];
  readonly unreadable: number;
}

export interface GuidedGate {
  readonly freeFixes: readonly RuleId[];
  readonly licensed: boolean;
}

interface Row {
  readonly rule: Rule;
  readonly result: RuleResult;
  /** Catalog position, the tie-breaker everywhere. */
  readonly index: number;
}

type Bucket = "accepted" | "eligible" | "left_alone" | "technical" | "later";

const RULES_BY_ID = new Map<RuleId, Rule>(MACOS_CATALOG.rules.map((rule) => [rule.id, rule]));

function rows(report: ScanReport): Row[] {
  const out: Row[] = [];
  report.results.forEach((result, index) => {
    const rule = RULES_BY_ID.get(result.ruleId);
    if (rule !== undefined) {
      out.push({ rule, result, index });
    }
  });
  return out;
}

function isPast(until: string | undefined, now: string): boolean {
  return until === undefined || Date.parse(until) <= Date.parse(now);
}

function bucketFor(row: Row, profile: ExplainerProfile, memory: GuidedMemory, now: string): Bucket {
  const id = row.rule.id;
  if (memory.accepted[id] !== undefined) {
    return "accepted";
  }
  if (LEFT_ALONE.includes(id)) {
    return "left_alone";
  }
  if (row.rule.category === "developer" && profile.technical === "low") {
    return "technical";
  }
  if (!isPast(memory.snoozed[id], now) || !isPast(memory.waiting[id], now)) {
    return "later";
  }
  return "eligible";
}

function byPoints(a: Row, b: Row): number {
  return b.result.points - a.result.points || a.index - b.index;
}

function isBatchable(rule: Rule): boolean {
  const apply = rule.fix.apply;
  return apply.kind === "in_app" && (apply.choice === "none" || apply.choice === "all_ssh_keys") && !apply.passphrase;
}

function showStep(rule: Rule, pane: SettingsPane, watch: readonly SectionKey[], watchEvery: number): GuidedStep {
  return {
    id: `show:${rule.id}`,
    kind: "show",
    ruleId: rule.id,
    pane,
    watch,
    watchEvery,
    restart: rule.fix.sideEffects === "restart",
    question: rule.id === "TL-MAC-026" ? "backup_disk" : null,
  };
}

function fixSteps(row: Row): GuidedStep[] {
  const apply = row.rule.fix.apply;
  if (apply.kind !== "in_app") {
    return [];
  }
  const steps: GuidedStep[] = [];
  for (const entry of row.result.evidence) {
    if (entry.value.kind !== "path" || (apply.choice === "share" && entry.key !== "sharePath")) {
      continue;
    }
    const path = entry.value.value;
    const choice: FixChoice = apply.choice === "share" ? { kind: "share", path } : { kind: "ssh_key", path };
    steps.push({ id: `fix:${row.rule.id}:${path}`, kind: "fix", ruleId: row.rule.id, choice, passphrase: apply.passphrase });
  }
  return steps;
}

/** Ordering rule steps 1 to 4 over eligible unlocked rows. */
function planSteps(unlocked: readonly Row[]): GuidedStep[] {
  const steps: GuidedStep[] = [];
  const batchable = unlocked.filter((row) => isBatchable(row.rule)).sort(byPoints);
  if (batchable.length >= 2) {
    steps.push({ id: "batch", kind: "batch", ruleIds: batchable.map((row) => row.rule.id) });
  } else if (batchable.length === 1) {
    const [only] = batchable;
    if (only !== undefined) {
      steps.push({ id: `fix:${only.rule.id}`, kind: "fix", ruleId: only.rule.id, choice: { kind: "none" }, passphrase: false });
    }
  }
  const withChoice = unlocked.filter((row) => row.rule.fix.apply.kind === "in_app" && !isBatchable(row.rule)).sort(byPoints);
  for (const row of withChoice) {
    steps.push(...fixSteps(row));
  }
  const deepLinks = unlocked.filter((row) => row.rule.fix.apply.kind === "deep_link").sort(byPoints);
  for (const restart of [false, true]) {
    for (const row of deepLinks) {
      const apply = row.rule.fix.apply;
      if (apply.kind === "deep_link" && (row.rule.fix.sideEffects === "restart") === restart) {
        steps.push(showStep(row.rule, apply.pane, apply.watch, apply.watchEvery * 1000));
      }
    }
  }
  return steps;
}

function failing(report: ScanReport, profile: ExplainerProfile, memory: GuidedMemory, now: string): Record<Bucket, Row[]> {
  const out: Record<Bucket, Row[]> = { accepted: [], eligible: [], left_alone: [], technical: [], later: [] };
  for (const row of rows(report)) {
    if (row.result.status === "fail") {
      out[bucketFor(row, profile, memory, now)].push(row);
    }
  }
  return out;
}

function needsFullDiskAccess(report: ScanReport): RuleId[] {
  return report.results
    .filter((result) => result.status === "unknown" && result.unknownReason === "needs_full_disk_access")
    .map((result) => result.ruleId);
}

export function buildGuidedPlan(report: ScanReport, gate: GuidedGate, profile: ExplainerProfile, memory: GuidedMemory, now: string): GuidedPlan {
  const buckets = failing(report, profile, memory, now);
  const free = new Set(gate.freeFixes);
  const unlocked = buckets.eligible.filter((row) => gate.licensed || free.has(row.rule.id));
  const locked = buckets.eligible.filter((row) => !gate.licensed && !free.has(row.rule.id)).map((row) => row.rule.id);
  const steps = planSteps(unlocked);
  const unlocks = needsFullDiskAccess(report);
  const askedAt = memory.permissionAskedAt.full_disk_access;
  if (unlocks.length > 0 && (askedAt === undefined || Date.parse(now) - Date.parse(askedAt) > PERMISSION_ASK_MS)) {
    steps.push({ id: "permission:full_disk_access", kind: "permission", permission: "full_disk_access", unlocks });
  }
  if (locked.length > 0 && (memory.paywallSnoozedUntil === null || isPast(memory.paywallSnoozedUntil, now))) {
    steps.push({ id: "paywall", kind: "paywall", lockedRuleIds: locked });
  }
  return {
    reportId: report.reportId,
    freeFixes: gate.freeFixes,
    steps,
    leftAlone: buckets.left_alone.map((row) => row.rule.id),
    worthALook: report.results.filter((result) => result.status === "review").map((result) => result.ruleId),
    technical: buckets.technical.map((row) => row.rule.id),
    later: buckets.later.map((row) => row.rule.id),
    locked,
    accepted: buckets.accepted.map((row) => row.rule.id),
    unreadable: report.results.filter((result) => result.status === "unknown").length,
  };
}

/** The rules the paywall unlocked, planned by the same ordering, to append after it. */
export function planLocked(report: ScanReport, ruleIds: readonly RuleId[], profile: ExplainerProfile, memory: GuidedMemory, now: string): readonly GuidedStep[] {
  const wanted = new Set(ruleIds);
  return planSteps(failing(report, profile, memory, now).eligible.filter((row) => wanted.has(row.rule.id)));
}

/**
 * The show step a rule becomes when its batch item or single fix failed: a deep link keeps its
 * own pane and watch; an in-app rule with a pane watches fix.apply.recheck. Null when it has no pane.
 */
export function convertedShowStep(ruleId: RuleId): GuidedStep | null {
  const rule = RULES_BY_ID.get(ruleId);
  if (rule === undefined) {
    return null;
  }
  const apply = rule.fix.apply;
  if (apply.kind === "deep_link") {
    return showStep(rule, apply.pane, apply.watch, apply.watchEvery * 1000);
  }
  if (apply.kind === "in_app" && rule.fix.settingsPane !== null) {
    return showStep(rule, rule.fix.settingsPane, apply.recheck, WATCH_EVERY_MS);
  }
  return null;
}
