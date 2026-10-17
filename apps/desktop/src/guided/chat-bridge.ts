import type { ChatOutcome, GuidedPlan, GuidedStep, RemindWhen, RuleId } from "@talos/core";
import { LATER_ASK_COUNT, acceptRules, planLocked, remindRules, reminderDate } from "@talos/core";
import { lastReport, rulePasses } from "../scan/machine";
import type { PermissionCardState } from "../scan/useCapabilityPoll";
import { start } from "./actions";
import type { Core } from "./core";
import { appendSteps, finalPlan, markFixed, openStep, writeMemory } from "./core";
import { PERMISSION } from "./copy";
import { daysAfter } from "./memory";
import { findingFor, guidedFor, ruleIdsOf } from "./plan";
import { batchLabel, readBatchOutcome, routeFailed, startBatch } from "./runBatch";
import { fixLabel, readCheckOutcome, readFixOutcome, startFix } from "./runFix";
import { startPermission } from "./runPermission";
import { markWatchPassed, noteWatchExpired, readShowOutcome, startShow } from "./runShow";
import type { ChatBridge, ChatSettled, ChatSettledState, GuidedPhase } from "./state";

type ChatPhase = Extract<GuidedPhase, { kind: "chat" }>;

function chatPhase(core: Core): ChatPhase | null {
  return core.phase.kind === "chat" ? core.phase : null;
}

function setActive(core: Core, active: GuidedStep | null): void {
  const phase = chatPhase(core);
  if (phase !== null) core.setPhase({ ...phase, active });
}

function stillSnoozed(until: string | undefined, now: string): boolean {
  return until !== undefined && Date.parse(until) > Date.parse(now);
}

/** A step the chat need not offer again this check-up: fixed, passing, snoozed, accepted, left alone, granted or snoozed paywall. */
export function stepDone(core: Core, step: GuidedStep, permission: PermissionCardState): boolean {
  const now = core.now();
  const { memory } = core;
  if (step.kind === "paywall") return core.deps.gate.licensed || stillSnoozed(memory.paywallSnoozedUntil ?? undefined, now);
  if (step.kind === "permission") return permission === "granted" || memory.permissionAskedAt[step.permission] !== undefined;
  const report = lastReport(core.scan.scan);
  return ruleIdsOf(step).every(
    (id) => core.fixed.includes(id) || core.leftAlone.has(id) || memory.accepted[id] !== undefined || stillSnoozed(memory.snoozed[id], now) || (report !== null && rulePasses(report, id)),
  );
}

/** The ChatOutcome a settled step state maps to. */
export function outcomeOf(state: ChatSettledState): ChatOutcome {
  if (state.kind === "done") return "fixed";
  if (state.kind === "expired") return "watch_expired";
  switch (state.error) {
    case "cancelled":
      return "cancelled";
    case "wrong_password":
      return "wrong_password";
    case "timeout":
      return "timeout";
    case "unreadable":
      return "could_not_check";
    default:
      return "did_not_change";
  }
}

function settled(core: Core, step: GuidedStep, state: ChatSettledState, outcome: ChatOutcome = outcomeOf(state)): ChatSettled {
  setActive(core, null);
  return { step, outcome, state };
}

/** Clears a settled fix off the machine before a new card starts, as the step primary does on a failed state. */
function clearSettledFix(core: Core): void {
  const scan = core.scan.scan;
  if (scan.kind === "ready" && scan.fixing !== null && (scan.fixing.phase === "done" || scan.fixing.phase === "failed")) core.scan.dismissFix();
}

function run(core: Core, bump: () => void, openPermission: () => void, step: GuidedStep, passphrase?: string): void {
  const phase = chatPhase(core);
  if (phase === null || step.kind === "paywall") return;
  appendSteps(core, [step]);
  if (phase.active?.id !== step.id) core.batchFailures = 0;
  core.watchSeen = false;
  setActive(core, step);
  switch (step.kind) {
    case "batch":
      clearSettledFix(core);
      startBatch(core, step, bump);
      return;
    case "fix":
      clearSettledFix(core);
      startFix(core, step, passphrase, bump);
      return;
    case "show":
      startShow(core, step);
      return;
    case "permission":
      startPermission(core, openPermission);
      return;
  }
}

function settle(core: Core, permission: PermissionCardState): ChatSettled | null {
  const active = chatPhase(core)?.active ?? null;
  if (active === null) return null;
  if (active.kind === "permission") return permission === "granted" ? settled(core, active, { kind: "done", line: PERMISSION.granted, rows: [] }) : null;
  const scan = core.scan.scan;
  if (scan.kind !== "ready" || scan.fixing === null || core.checking) return null;
  const { fixing } = scan;
  if (fixing.phase !== "done" && fixing.phase !== "failed") return null;
  if (fixing.kind === "batch" && active.kind === "batch") {
    core.scan.dismissFix();
    const read = readBatchOutcome(core, active, fixing);
    if (read.nothingRan && read.state.kind === "failed" && read.state.error === "command_failed") {
      core.batchFailures += 1;
      if (core.batchFailures >= 2) routeFailed(core, active.ruleIds);
    }
    markFixed(core, read.fixed);
    routeFailed(core, read.route);
    return settled(core, active, read.state);
  }
  if (fixing.kind === "single" && active.kind === "fix") {
    core.scan.dismissFix();
    const read = readFixOutcome(active, fixing);
    markFixed(core, read.fixed);
    return settled(core, active, read.state);
  }
  return null;
}

function observeShow(core: Core): ChatSettled | null {
  const active = chatPhase(core)?.active ?? null;
  if (active === null || active.kind !== "show") return null;
  const read = readShowOutcome(core, active);
  if (read === "passed") {
    markWatchPassed(core, active);
    return settled(core, active, { kind: "done", line: doneLine(active), rows: [] }, "watch_passed");
  }
  if (read === "expired") {
    noteWatchExpired(core, active);
    return settled(core, active, { kind: "expired" });
  }
  return null;
}

function doneLine(step: Extract<GuidedStep, { kind: "show" | "fix" }>): string {
  return guidedFor(step.ruleId).done;
}

async function checkAgain(core: Core, step: GuidedStep): Promise<ChatSettled | null> {
  const scan = core.scan.scan;
  if (chatPhase(core) === null || scan.kind !== "ready") return null;
  if (step.kind === "fix") {
    const finding = findingFor(scan.report, step.ruleId);
    const sections = finding?.fix.apply.kind === "in_app" ? finding.fix.apply.recheck : [];
    setActive(core, step);
    core.checking = true;
    await core.scan.recheck(sections);
    core.checking = false;
    const read = readCheckOutcome(core, step);
    if (read === null) return null;
    markFixed(core, read.fixed);
    return settled(core, step, read.state);
  }
  if (step.kind !== "show") return null;
  core.checking = true;
  await core.scan.recheck(step.watch);
  core.checking = false;
  if (chatPhase(core)?.active?.id !== step.id || readShowOutcome(core, step) !== "passed") return null;
  markWatchPassed(core, step);
  return settled(core, step, { kind: "done", line: doneLine(step), rows: [] }, "watch_passed");
}

function clearIfActive(core: Core, step: GuidedStep): void {
  if (chatPhase(core)?.active?.id === step.id) setActive(core, null);
}

function snoozePaywall(core: Core): void {
  if (chatPhase(core) === null) return;
  writeMemory(core, { paywallSnoozedUntil: daysAfter(core.now(), 14) });
}

function later(core: Core, step: GuidedStep): readonly RuleId[] {
  if (chatPhase(core) === null) return [];
  const now = core.now();
  if (step.kind === "paywall") {
    snoozePaywall(core);
    return [];
  }
  if (step.kind === "permission") {
    writeMemory(core, { permissionAskedAt: { ...core.memory.permissionAskedAt, [step.permission]: now } });
    clearIfActive(core, step);
    return [];
  }
  const scan = core.scan.scan;
  const rules = ruleIdsOf(step);
  if (scan.kind === "ready" && scan.watching !== null && rules.includes(scan.watching.ruleId)) core.scan.stopWatch();
  const snoozed = { ...core.memory.snoozed };
  const laterCount = { ...core.memory.laterCount };
  for (const id of rules) {
    snoozed[id] = daysAfter(now, 7);
    laterCount[id] = (laterCount[id] ?? 0) + 1;
  }
  writeMemory(core, { snoozed, laterCount });
  clearIfActive(core, step);
  return rules.filter((id) => (laterCount[id] ?? 0) >= LATER_ASK_COUNT);
}

/** The reminder replaces the snooze "Do this later" wrote; laterCount stands so the third-Later ask is not advanced (2f). */
function remindIds(core: Core, rules: readonly RuleId[], when: RemindWhen): void {
  if (chatPhase(core) === null || rules.length === 0) return;
  const next = remindRules(core.memory, rules, reminderDate(core.now(), when));
  writeMemory(core, { snoozed: next.snoozed, reminders: next.reminders });
}

function remind(core: Core, step: GuidedStep, when: RemindWhen): void {
  if (chatPhase(core) === null || step.kind === "paywall" || step.kind === "permission") return;
  const rules = ruleIdsOf(step);
  const scan = core.scan.scan;
  if (scan.kind === "ready" && scan.watching !== null && rules.includes(scan.watching.ruleId)) core.scan.stopWatch();
  remindIds(core, rules, when);
  clearIfActive(core, step);
}

function accept(core: Core, ruleIds: readonly RuleId[]): void {
  const phase = chatPhase(core);
  if (phase === null || ruleIds.length === 0) return;
  writeMemory(core, acceptRules(core.memory, ruleIds, core.now()));
  const accepted = Object.keys(core.memory.accepted) as RuleId[];
  for (const id of ruleIds) core.leftAlone.delete(id);
  core.extras = core.extras.filter((e) => ruleIdsOf(e).some((r) => !accepted.includes(r)));
  if (phase.active !== null && ruleIdsOf(phase.active).every((r) => accepted.includes(r))) setActive(core, null);
}

function answerNo(core: Core, step: GuidedStep): void {
  if (chatPhase(core) === null || step.kind !== "show" || step.question === null) return;
  writeMemory(core, { snoozed: { ...core.memory.snoozed, [step.ruleId]: daysAfter(core.now(), 30) } });
  clearIfActive(core, step);
}

function leaveAlone(core: Core, step: GuidedStep): void {
  if (chatPhase(core) === null) return;
  for (const id of ruleIdsOf(step)) core.leftAlone.add(id);
  clearIfActive(core, step);
}

function unlock(core: Core): readonly GuidedStep[] {
  const phase = chatPhase(core);
  if (phase === null) return [];
  const report = lastReport(core.scan.scan);
  const steps = report === null ? [] : planLocked(report, phase.plan.locked, core.deps.settings.profile, core.memory, core.now());
  const have = new Set(phase.plan.steps.map((s) => s.id));
  appendSteps(core, steps);
  const after = chatPhase(core);
  if (after !== null) core.setPhase({ ...after, plan: { ...after.plan, locked: [] } });
  return steps.filter((s) => !have.has(s.id));
}

/** The plan with the settled steps first, so the walk-through's passed prefix is right. */
function orderedForWalk(core: Core, plan: GuidedPlan, permission: PermissionCardState): { plan: GuidedPlan; index: number } {
  const done = plan.steps.filter((s) => stepDone(core, s, permission));
  const undone = plan.steps.filter((s) => !stepDone(core, s, permission));
  return { plan: { ...plan, steps: [...done, ...undone] }, index: done.length };
}

function stepByStep(core: Core, permission: PermissionCardState): void {
  const phase = chatPhase(core);
  if (phase === null) return;
  core.batchFailures = 0;
  core.watchSeen = false;
  const { plan, index } = orderedForWalk(core, phase.plan, permission);
  openStep(core, plan, index);
}

/** True while the active card runs on the scan machine: a fix or batch not settled, or a watcher still waiting. */
function inFlight(core: Core, active: GuidedStep): boolean {
  const scan = core.scan.scan;
  if (scan.kind === "rechecking") return true;
  if (scan.kind !== "ready") return false;
  if (active.kind === "show") return scan.watching !== null && scan.watching.ruleId === active.ruleId && scan.watching.passedAt === null;
  return scan.fixing !== null && scan.fixing.phase !== "done" && scan.fixing.phase !== "failed";
}

function leaveChat(core: Core, permission: PermissionCardState): void {
  const phase = chatPhase(core);
  if (phase === null) return;
  const { active } = phase;
  if (active !== null && inFlight(core, active)) {
    const rest = phase.plan.steps.filter((s) => s.id !== active.id);
    const { plan, index } = orderedForWalk(core, { ...phase.plan, steps: rest }, permission);
    const scan = core.scan.scan;
    const watching = scan.kind === "ready" ? scan.watching : null;
    const fixing = scan.kind === "ready" ? scan.fixing : null;
    const state =
      active.kind === "show"
        ? { kind: "watching" as const, since: watching?.startedAt ?? core.now(), stale: false }
        : { kind: "working" as const, label: fixing === null ? "" : fixing.kind === "batch" ? batchLabel(fixing) : fixLabel(fixing) };
    core.setPhase({ kind: "step", plan: { ...plan, steps: [...plan.steps.slice(0, index), active, ...plan.steps.slice(index)] }, index, state, notice: null });
    return;
  }
  const { plan, index } = orderedForWalk(core, phase.plan, permission);
  if (index >= plan.steps.length) core.setPhase({ kind: "end", plan: finalPlan(core, plan), fixed: [...core.fixed] });
  else core.setPhase({ kind: "plan", plan: phase.plan, listOpen: false, same: false });
}

function toChat(core: Core): void {
  const { phase } = core;
  if (phase.kind === "chat") return;
  if (phase.kind !== "since" && phase.kind !== "plan" && phase.kind !== "step" && phase.kind !== "end") return;
  if (phase.kind === "step" && (phase.state.kind === "working" || phase.state.kind === "watching")) return;
  core.setPhase({ kind: "chat", plan: phase.plan, diff: phase.kind === "since" ? phase.diff : null, active: null, walking: false, resumed: false, reminders: [] });
}

function after<T>(bump: () => void, value: T): T {
  bump();
  return value;
}

/** The bridge's functions, built once over the core ref; the readonly fields are composed per render by useGuided. */
export function buildChatBridge(core: Core, bump: () => void, openPermission: () => void, permission: () => PermissionCardState): Omit<ChatBridge, "plan" | "diff" | "resumed" | "active" | "walking" | "fixed" | "leftAlone" | "doneStepIds" | "permission" | "reminders"> {
  const undone = () => (chatPhase(core)?.plan.steps ?? []).filter((s) => !stepDone(core, s, permission()));
  return {
    undone,
    nextUndone: () => undone()[0] ?? null,
    atEnd: () => undone().length === 0,
    endPlan: () => {
      const phase = chatPhase(core);
      return phase === null ? null : finalPlan(core, phase.plan);
    },
    run: (step, passphrase) => run(core, bump, openPermission, step, passphrase),
    checkAgain: (step) => checkAgain(core, step),
    settle: () => settle(core, permission()),
    observeShow: () => observeShow(core),
    watchingSince: () => {
      const active = chatPhase(core)?.active ?? null;
      const scan = core.scan.scan;
      if (active?.kind !== "show" || scan.kind !== "ready" || scan.watching?.ruleId !== active.ruleId) return null;
      return scan.watching.startedAt;
    },
    // A memory write changes which steps count as done, so each one re-renders the phase.
    later: (step) => after(bump, later(core, step)),
    remind: (step, when) => after(bump, remind(core, step, when)),
    remindRules: (ruleIds, when) => after(bump, remindIds(core, ruleIds, when)),
    accept: (ruleIds) => after(bump, accept(core, ruleIds)),
    answerNo: (step) => after(bump, answerNo(core, step)),
    leaveAlone: (step) => after(bump, leaveAlone(core, step)),
    snoozePaywall: () => after(bump, snoozePaywall(core)),
    unlock: () => unlock(core),
    setWalking: (walking) => {
      const phase = chatPhase(core);
      if (phase !== null && phase.walking !== walking) core.setPhase({ ...phase, walking });
    },
    stepByStep: () => stepByStep(core, permission()),
    leaveChat: () => leaveChat(core, permission()),
    toChat: () => toChat(core),
    rescan: () => start(core),
  };
}
