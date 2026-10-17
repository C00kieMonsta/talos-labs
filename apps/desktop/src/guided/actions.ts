import type { GuidedPlan, GuidedStep, NextAction, RuleId } from "@talos/core";
import { LATER_ASK_COUNT, acceptRules, planLocked } from "@talos/core";
import { lastReport } from "../scan/machine";
import type { Core } from "./core";
import { advance, appendSteps, currentStep, finalPlan, initialStepState, openStep, setStep, writeMemory } from "./core";
import { daysAfter } from "./memory";
import { ACCEPT, LATER_FLASH, PAYWALL, QUESTION } from "./copy";
import { ACCEPT_FLASH_MS, LATER_FLASH_MS, QUESTION_FLASH_MS, THANK_YOU_MS, paced } from "./timing";
import { ruleIdsOf, withoutAccepted } from "./plan";

/** "Do this later": snooze the step's rules for 7 days, flash, advance. The paywall and permission links have their own meaning. */
export function later(core: Core): void {
  const step = currentStep(core);
  if (step === null) return;
  const now = core.now();
  if (step.kind === "paywall") {
    writeMemory(core, { paywallSnoozedUntil: daysAfter(now, 14) });
    // Unlock moved the paywall before a step: carry on to it. Otherwise the end screen, even when a converted show step was appended behind the paywall.
    if (core.paywallMoved) {
      core.paywallMoved = false;
      advance(core);
      return;
    }
    if (core.phase.kind === "step") core.setPhase({ kind: "end", plan: finalPlan(core, core.phase.plan), fixed: [...core.fixed] });
    return;
  }
  if (step.kind === "permission") {
    writeMemory(core, { permissionAskedAt: { ...core.memory.permissionAskedAt, [step.permission]: now } });
    advance(core);
    return;
  }
  if (core.phase.kind === "step" && core.phase.state.kind === "watching") core.scan.stopWatch();
  const snoozed = { ...core.memory.snoozed };
  const laterCount = { ...core.memory.laterCount };
  for (const id of ruleIdsOf(step)) {
    snoozed[id] = daysAfter(now, 7);
    laterCount[id] = (laterCount[id] ?? 0) + 1;
  }
  writeMemory(core, { snoozed, laterCount });
  // The third Later asks instead of retiring: only the person's answer stops a step (DESIGN-ACCEPT.md section 2).
  const asked = ruleIdsOf(step).filter((id) => (laterCount[id] ?? 0) >= LATER_ASK_COUNT);
  if (asked.length > 0) {
    setStep(core, { kind: "ask_accept", ruleIds: asked });
    return;
  }
  flashThenAdvance(core, LATER_FLASH, paced(LATER_FLASH_MS));
}

/** The rules the ask screen is about, or none when the current step is not asking. */
function askedRules(core: Core): readonly RuleId[] {
  const { phase } = core;
  return phase.kind === "step" && phase.state.kind === "ask_accept" ? phase.state.ruleIds : [];
}

/** "No, keep asking": the count goes back to 0 so the question returns after three more Laters; the snooze stands. No flash. */
export function keepAsking(core: Core): void {
  const asked = askedRules(core);
  if (asked.length === 0) return;
  const laterCount = { ...core.memory.laterCount };
  for (const id of asked) laterCount[id] = 0;
  writeMemory(core, { laterCount });
  advance(core);
}

/** "Leave it alone, I know the risk": accept the asked rules, forget them this run, flash, advance. */
export function accept(core: Core): void {
  const asked = askedRules(core);
  if (asked.length === 0) return;
  writeMemory(core, acceptRules(core.memory, asked, core.now()));
  const accepted = Object.keys(core.memory.accepted) as RuleId[];
  for (const id of asked) core.leftAlone.delete(id);
  core.extras = core.extras.flatMap((e) => {
    const kept = withoutAccepted(e, accepted);
    return kept === null ? [] : [kept];
  });
  flashThenAdvance(core, asked.length === 1 ? ACCEPT.flash : ACCEPT.flashMany, paced(ACCEPT_FLASH_MS));
}

export function flashThenAdvance(core: Core, text: string, ms: number): void {
  setStep(core, { kind: "later_flash", text });
  setTimeout(() => {
    if (core.phase.kind === "step" && core.phase.state.kind === "later_flash") advance(core);
  }, ms);
}

/** The Next link under a done line, and the only button of a "left alone" failure. */
export function next(core: Core): void {
  const step = currentStep(core);
  const { phase } = core;
  if (step === null || phase.kind !== "step") return;
  if (phase.state.kind === "failed") for (const id of ruleIdsOf(step)) core.leftAlone.add(id);
  advance(core);
}

/** The 026 question. Yes opens the pane as the primary would; No snoozes 026 for 30 days. */
export function answer(core: Core, yes: boolean, primary: () => void): void {
  const step = currentStep(core);
  if (step === null || step.kind !== "show" || step.question === null) return;
  if (yes) {
    setStep(core, { kind: "idle" });
    primary();
    return;
  }
  writeMemory(core, { snoozed: { ...core.memory.snoozed, [step.ruleId]: daysAfter(core.now(), 30) } });
  flashThenAdvance(core, QUESTION.flash, paced(QUESTION_FLASH_MS));
}

export function toggleList(core: Core): void {
  const { phase } = core;
  if (phase.kind === "plan") core.setPhase({ ...phase, listOpen: !phase.listOpen });
}

/** since -> plan or end, plan -> first step, a partial batch -> next. */
export function carryOn(core: Core): void {
  const { phase } = core;
  if (phase.kind === "since") {
    if (phase.plan.steps.length === 0) core.setPhase({ kind: "end", plan: finalPlan(core, phase.plan), fixed: [...core.fixed] });
    else core.setPhase({ kind: "plan", plan: phase.plan, listOpen: false, same: false });
    return;
  }
  if (phase.kind === "plan") {
    openStep(core, phase.plan, 0);
    return;
  }
  if (phase.kind === "step" && phase.state.kind === "done") advance(core);
}

/** Welcome -> scanning, the failed and stopped screens, and "Check again" on the end screen. */
export function start(core: Core): void {
  core.extras = [];
  core.leftAlone = new Set();
  core.fixed = [];
  core.ofFloor = 0;
  core.batchFailures = 0;
  core.watchSeen = false;
  core.paywallMoved = false;
  core.previousReport = lastReport(core.scan.scan);
  core.setPhase({ kind: "scanning" });
  void core.scan.start();
}

/** After the licence turned valid on the paywall: thank, plan the unlocked rules, append them, carry on. */
export function licenceAccepted(core: Core): void {
  const step = currentStep(core);
  const { phase } = core;
  if (step === null || step.kind !== "paywall" || phase.kind !== "step") return;
  const report = lastReport(core.scan.scan);
  const unlocked: readonly RuleId[] = step.lockedRuleIds;
  const steps = report === null ? [] : planLocked(report, unlocked, core.deps.settings.profile, core.memory, core.now());
  core.paywallMoved = false;
  appendSteps(core, steps);
  const after = core.phase;
  if (after.kind !== "step") return;
  const plan: GuidedPlan = { ...after.plan, locked: [] };
  core.setPhase({ ...after, plan, state: { kind: "later_flash", text: `${PAYWALL.thanks} ${PAYWALL.carrying}` } });
  setTimeout(() => {
    if (core.phase.kind === "step" && core.phase.state.kind === "later_flash") advance(core);
  }, paced(THANK_YOU_MS));
}

/**
 * "Do this next" on the end screen. The step goes last in the plan so the way out is the end screen again,
 * then it runs as its own primary would: the fix starts, the pane opens, the paywall shows. A passphrase step
 * only opens, since the form has to be filled first.
 */
export function doNext(core: Core, action: NextAction, primary: () => void): void {
  const { phase } = core;
  if (phase.kind !== "end" || action.step === null) return;
  const step = action.step;
  if (!core.extras.some((e) => e.id === step.id)) core.extras.push(step);
  const steps = [...phase.plan.steps.filter((s) => s.id !== step.id), step];
  const plan: GuidedPlan = { ...phase.plan, steps };
  core.ofFloor = Math.max(core.ofFloor, steps.length);
  core.batchFailures = 0;
  core.watchSeen = false;
  core.setPhase({ kind: "step", plan, index: steps.length - 1, state: initialStepState(step), notice: null });
  if (step.kind === "show" || (step.kind === "fix" && !step.passphrase)) primary();
}

/**
 * Unlock from a step's Explain disclosure. The paywall step moves to just before the current step and opens,
 * so "Not now" and a valid key both carry on to the step the person was on. The total does not grow.
 */
export function goToPaywall(core: Core): void {
  const { phase } = core;
  if (phase.kind !== "step") return;
  const current = phase.plan.steps[phase.index];
  if (current === undefined || current.kind === "paywall") return;
  // Not an extra: a rebuild pins the paywall while it is the current step and keeps it as passed afterwards.
  const paywall: GuidedStep = phase.plan.steps.find((s) => s.kind === "paywall") ?? { id: "paywall", kind: "paywall", lockedRuleIds: phase.plan.locked };
  const rest = phase.plan.steps.filter((s) => s.id !== paywall.id);
  const at = rest.findIndex((s) => s.id === current.id);
  const steps = [...rest.slice(0, at), paywall, ...rest.slice(at)];
  const plan: GuidedPlan = { ...phase.plan, steps };
  core.ofFloor = Math.max(core.ofFloor, steps.length);
  core.batchFailures = 0;
  core.watchSeen = false;
  core.paywallMoved = true;
  core.setPhase({ kind: "step", plan, index: at, state: initialStepState(paywall), notice: null });
}
