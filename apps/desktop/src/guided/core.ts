import type { GuidedMemory, GuidedPlan, GuidedStep, RuleId, ScanReport } from "@talos/core";
import { buildGuidedPlan } from "@talos/core";
import { lastReport } from "../scan/machine";
import type { ScanController } from "../scan/useScan";
import type { GuidedDeps, GuidedPhase, StepState } from "./state";
import { ruleIdsOf } from "./plan";

/**
 * What the action modules share. Fields are mutable so a callback that fires after an await sees the
 * latest values; `setPhase` updates the ref and the React state together.
 */
export interface Core {
  phase: GuidedPhase;
  memory: GuidedMemory;
  /** The last value handed to saveMemory, to tell a lagging deps.memory from an outside change. */
  lastSaved: GuidedMemory | null;
  deps: GuidedDeps;
  scan: ScanController;
  /** Converted show steps and the steps the paywall unlocked; kept across rebuilds while their rule fails. */
  extras: GuidedStep[];
  /** Rules the person moved past without a fix this check-up. */
  leftAlone: Set<RuleId>;
  /** Rules fixed in this run, for the end screen. */
  fixed: RuleId[];
  /** The report held before the launch scan, for "since last time". */
  previousReport: ScanReport | null;
  /** The last report the controller built a plan from; a different object means a rebuild is due. */
  plannedReport: ScanReport | null;
  /** The progress total never goes down within a check-up. */
  ofFloor: number;
  /** command_failed outcomes in a row on the current batch step. */
  batchFailures: number;
  /** True after a watcher was seen running for the current step, so a null watcher means it expired. */
  watchSeen: boolean;
  /** Set when the launch continue note was "guided": the next plan opens at its first step. */
  resume: boolean;
  /** A free recheck is in flight for the current step ("Check again"). */
  checking: boolean;
  /** True from the first collecting render until the report lands, so the previous report is captured once. */
  inScan: boolean;
  setPhase(phase: GuidedPhase): void;
  now(): string;
}

export function writeMemory(core: Core, patch: Partial<GuidedMemory>): void {
  core.memory = { ...core.memory, ...patch };
  core.lastSaved = core.memory;
  core.deps.saveMemory(core.memory);
}

export function currentStep(core: Core): GuidedStep | null {
  const { phase } = core;
  return phase.kind === "step" ? (phase.plan.steps[phase.index] ?? null) : null;
}

export function setStep(core: Core, state: StepState, notice?: string | null): void {
  const { phase } = core;
  if (phase.kind !== "step") return;
  core.setPhase({ ...phase, state, notice: notice === undefined ? phase.notice : notice });
}

/** Replaces the step at the current index, e.g. a fix step that becomes a show step. */
export function replaceCurrentStep(core: Core, step: GuidedStep): void {
  const { phase } = core;
  if (phase.kind !== "step") return;
  const steps = phase.plan.steps.map((s, i) => (i === phase.index ? step : s));
  core.setPhase({ ...phase, plan: { ...phase.plan, steps }, state: { kind: "idle" } });
}

/** The initial state of a step: the backup question for 026, idle for everything else. */
export function initialStepState(step: GuidedStep): StepState {
  return step.kind === "show" && step.question !== null ? { kind: "question" } : { kind: "idle" };
}

/** The end screen's lists, rebuilt with the latest memory so a rule snoozed this run shows under "Still waiting". */
export function finalPlan(core: Core, plan: GuidedPlan): GuidedPlan {
  const report = lastReport(core.scan.scan);
  if (report === null) return plan;
  const { gate, settings } = core.deps;
  const fresh = buildGuidedPlan(report, { freeFixes: plan.freeFixes, licensed: gate.licensed }, settings.profile, core.memory, core.now());
  const extra = [...core.leftAlone].filter((r) => !fresh.leftAlone.includes(r) && report.findings.some((f) => f.ruleId === r));
  return { ...fresh, steps: plan.steps, leftAlone: [...fresh.leftAlone, ...extra], locked: plan.locked.length === 0 && gate.licensed ? [] : fresh.locked };
}

/** Opens step `index` of `plan`, or the end state past the last step. */
export function openStep(core: Core, plan: GuidedPlan, index: number, notice: string | null = null): void {
  const step = plan.steps[index];
  if (step === undefined) {
    core.setPhase({ kind: "end", plan: finalPlan(core, plan), fixed: [...core.fixed] });
    return;
  }
  core.ofFloor = Math.max(core.ofFloor, plan.steps.length);
  core.setPhase({ kind: "step", plan, index, state: initialStepState(step), notice });
}

/** Moves to the next step; the notice shows on the screen that opens. */
export function advance(core: Core, notice: string | null = null): void {
  const { phase } = core;
  if (phase.kind !== "step") return;
  core.batchFailures = 0;
  core.watchSeen = false;
  openStep(core, phase.plan, phase.index + 1, notice);
}

export function markFixed(core: Core, ruleIds: readonly RuleId[]): void {
  for (const id of ruleIds) if (!core.fixed.includes(id)) core.fixed.push(id);
}

/** Appends steps after the current plan; duplicates by id are dropped. */
export function appendSteps(core: Core, steps: readonly GuidedStep[]): void {
  const { phase } = core;
  if (phase.kind !== "step") return;
  const have = new Set(phase.plan.steps.map((s) => s.id));
  const fresh = steps.filter((s) => !have.has(s.id));
  for (const s of fresh) if (!core.extras.some((e) => e.id === s.id)) core.extras.push(s);
  if (fresh.length === 0) return;
  const plan = { ...phase.plan, steps: [...phase.plan.steps, ...fresh] };
  core.ofFloor = Math.max(core.ofFloor, plan.steps.length);
  core.setPhase({ ...phase, plan });
}

/** Rules of the current step that still fail in the held report. */
export function stillFailing(core: Core, report: ScanReport): readonly RuleId[] {
  const step = currentStep(core);
  if (step === null) return [];
  return ruleIdsOf(step).filter((id) => report.findings.some((f) => f.ruleId === id));
}
