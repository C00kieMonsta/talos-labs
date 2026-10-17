import type { GuidedPlan, GuidedStep, RuleId, ScanReport } from "@talos/core";
import { buildGuidedPlan, clearAcceptedThatPass, diffReports } from "@talos/core";
import { rulePasses } from "../scan/machine";
import type { Core } from "./core";
import { finalPlan, openStep, writeMemory } from "./core";
import { mergePlan, ruleIdsOf } from "./plan";

/** A check that passed takes its acceptance with it (DESIGN-ACCEPT.md section 3, item 10); 027 and 010 keep theirs. */
function clearPassedAcceptances(core: Core, report: ScanReport): void {
  const cleared = clearAcceptedThatPass(core.memory, report);
  if (cleared !== core.memory) writeMemory(core, { accepted: cleared.accepted });
}

/** The paced scan landed: freeze the free set, diff against the previous report, open since, plan or end. */
export function landed(core: Core, report: ScanReport): void {
  clearPassedAcceptances(core, report);
  const { gate, settings } = core.deps;
  const now = core.now();
  const plan = buildGuidedPlan(report, { freeFixes: gate.freeFixes, licensed: gate.licensed }, settings.profile, core.memory, now);
  const diff = diffReports(core.previousReport, report, core.memory.pendingRestart);
  const pendingRestart = core.memory.pendingRestart.filter((id) => !rulePasses(report, id));
  if (pendingRestart.length !== core.memory.pendingRestart.length) writeMemory(core, { pendingRestart });
  core.plannedReport = report;
  core.ofFloor = plan.steps.length;
  core.batchFailures = 0;
  core.watchSeen = false;
  core.paywallMoved = false;
  core.checking = false;
  if (core.resume) {
    core.resume = false;
    openStep(core, plan, 0);
    return;
  }
  const changed = diff.fixed.length + diff.appeared.length + diff.unreadable.length > 0;
  if (changed) {
    core.setPhase({ kind: "since", diff, plan });
    return;
  }
  if (plan.steps.length === 0) {
    core.setPhase({ kind: "end", plan, fixed: [] });
    return;
  }
  core.setPhase({ kind: "plan", plan, listOpen: false, same: core.previousReport !== null });
}

/** A recheck, a watch tick or a fix changed the report: rebuild with the frozen free set and keep the place. */
export function rebuilt(core: Core, report: ScanReport): void {
  const { phase } = core;
  if (phase.kind !== "since" && phase.kind !== "plan" && phase.kind !== "step" && phase.kind !== "end") return;
  clearPassedAcceptances(core, report);
  const { gate, settings } = core.deps;
  const old = phase.plan;
  const fresh = buildGuidedPlan(report, { freeFixes: old.freeFixes, licensed: gate.licensed }, settings.profile, core.memory, core.now());
  core.plannedReport = report;
  const steps = releaseAskedAgain(core, old, fresh, phase.kind === "step" ? phase.index : null);
  const index = phase.kind === "step" ? steps.index : phase.kind === "end" ? steps.kept.length : 0;
  const held: GuidedPlan = { ...old, steps: steps.kept };
  // A paywall the person is on stays where it is (Unlock may have moved it), so the fresh plan's copy is dropped and nothing lands before it.
  const onPaywall = phase.kind === "step" && old.steps[phase.index]?.kind === "paywall";
  // A rule accepted on Details leaves the ask screen; with none left to ask, the step goes like an idle one.
  const asking = phase.kind === "step" && phase.state.kind === "ask_accept" ? phase.state.ruleIds.filter((id) => !fresh.accepted.includes(id)) : null;
  const askDone = asking !== null && asking.length === 0;
  const pinCurrent = phase.kind === "step" && ((phase.state.kind !== "idle" && phase.state.kind !== "question" && !askDone) || onPaywall);
  const plan = mergePlan({ old: held, index, pinCurrent, fresh, report, extras: core.extras, leftAlone: core.leftAlone });
  core.ofFloor = Math.max(core.ofFloor, plan.steps.length);
  switch (phase.kind) {
    case "since":
      core.setPhase({ ...phase, plan });
      return;
    case "plan":
      if (plan.steps.length === 0) core.setPhase({ kind: "end", plan: finalPlan(core, plan), fixed: [...core.fixed] });
      else core.setPhase({ ...phase, plan });
      return;
    case "end":
      // A step gained past the old end (a rule asked about again, a reset) opens; with none, the end screen stays.
      openStep(core, plan, index);
      return;
    case "step": {
      const current = old.steps[phase.index];
      const found = current === undefined ? -1 : plan.steps.findIndex((s) => s.id === current.id);
      // Fresh steps filed before an unpinned current step (a rule asked about again, a reset) would count as passed
      // without being shown: they go directly after it instead, and the person's place holds.
      const unseen = !pinCurrent && found > index ? plan.steps.slice(index, found) : [];
      const ordered: GuidedPlan = unseen.length === 0 ? plan : { ...plan, steps: [...plan.steps.slice(0, index), ...plan.steps.slice(found, found + 1), ...unseen, ...plan.steps.slice(found + 1)] };
      const at = unseen.length === 0 ? found : index;
      if (at >= 0 && !askDone) {
        const state = asking !== null && phase.state.kind === "ask_accept" && asking.length < phase.state.ruleIds.length ? { kind: "ask_accept" as const, ruleIds: asking } : phase.state;
        core.setPhase({ ...phase, plan: ordered, index: at, state });
        return;
      }
      // The current step's rule passed or was accepted elsewhere: the next step moves into its place.
      openStep(core, ordered, at >= 0 ? at : index, phase.notice);
    }
  }
}

/**
 * A rule accepted before and not now ("Ask me again", a reset) gives up the passed step it was accepted on,
 * so the merge proposes its fresh step again instead of treating the rule as already handled. The step the
 * person is on is never released. Returns the steps to merge from and the index moved back past the gaps.
 */
function releaseAskedAgain(core: Core, old: GuidedPlan, fresh: GuidedPlan, current: number | null): { kept: GuidedStep[]; index: number } {
  // The plan's list is fresh at the end; mid-run it lags an accept, which the controller's last save holds.
  const before = new Set<RuleId>([...old.accepted, ...(Object.keys(core.lastSaved?.accepted ?? {}) as RuleId[])]);
  const proposed = new Set(fresh.steps.flatMap(ruleIdsOf));
  const again = new Set([...before].filter((id) => core.memory.accepted[id] === undefined && proposed.has(id)));
  if (again.size === 0) return { kept: [...old.steps], index: current ?? old.steps.length };
  const released = (step: GuidedStep, i: number) => i !== current && ruleIdsOf(step).some((id) => again.has(id));
  const kept = old.steps.filter((step, i) => !released(step, i));
  const gaps = old.steps.slice(0, current ?? old.steps.length).filter(released).length;
  return { kept, index: (current ?? old.steps.length) - gaps };
}
