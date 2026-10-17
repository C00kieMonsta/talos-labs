import type { ScanReport } from "@talos/core";
import { buildGuidedPlan, diffReports } from "@talos/core";
import { rulePasses } from "../scan/machine";
import type { Core } from "./core";
import { finalPlan, openStep, writeMemory } from "./core";
import { mergePlan } from "./plan";

/** The paced scan landed: freeze the free set, diff against the previous report, open since, plan or end. */
export function landed(core: Core, report: ScanReport): void {
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
  const { gate, settings } = core.deps;
  const old = phase.plan;
  const fresh = buildGuidedPlan(report, { freeFixes: old.freeFixes, licensed: gate.licensed }, settings.profile, core.memory, core.now());
  core.plannedReport = report;
  const index = phase.kind === "step" ? phase.index : phase.kind === "end" ? old.steps.length : 0;
  // A paywall the person is on stays where it is (Unlock may have moved it), so the fresh plan's copy is dropped and nothing lands before it.
  const onPaywall = phase.kind === "step" && old.steps[phase.index]?.kind === "paywall";
  const pinCurrent = phase.kind === "step" && ((phase.state.kind !== "idle" && phase.state.kind !== "question") || onPaywall);
  const plan = mergePlan({ old, index, pinCurrent, fresh, report, extras: core.extras, leftAlone: core.leftAlone });
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
      core.setPhase({ ...phase, plan });
      return;
    case "step": {
      const current = old.steps[phase.index];
      const at = current === undefined ? -1 : plan.steps.findIndex((s) => s.id === current.id);
      if (at >= 0) {
        core.setPhase({ ...phase, plan, index: at });
        return;
      }
      // The current step's rule passed elsewhere: the next step moves into its place.
      openStep(core, plan, phase.index, phase.notice);
    }
  }
}
