import type { GuidedStep } from "@talos/core";
import { rulePasses } from "../scan/machine";
import type { Core } from "./core";
import { advance, markFixed, setStep, writeMemory } from "./core";
import { SHOW } from "./copy";
import { hoursAfter } from "./memory";
import { guidedFor } from "./plan";

type ShowStep = Extract<GuidedStep, { kind: "show" }>;

/** "Show me where": open the pane, start the watcher, note a restart rule. */
export function startShow(core: Core, step: ShowStep): void {
  void core.deps.openPane(step.pane);
  core.scan.startWatch(step.ruleId, { sections: step.watch, everyMs: step.watchEvery });
  if (step.restart && !core.memory.pendingRestart.includes(step.ruleId)) {
    writeMemory(core, { pendingRestart: [...core.memory.pendingRestart, step.ruleId] });
  }
  core.watchSeen = false;
  setStep(core, { kind: "watching", since: core.now(), stale: false });
}

/** Called on every scan state change while the step watches. */
export function observeWatch(core: Core, step: ShowStep): void {
  const { phase } = core;
  if (phase.kind !== "step" || phase.state.kind !== "watching") return;
  const scan = core.scan.scan;
  if (scan.kind !== "ready" && scan.kind !== "rechecking") return;
  const watching = scan.watching;
  if (watching !== null && watching.ruleId === step.ruleId) {
    core.watchSeen = true;
    if (watching.passedAt !== null) passed(core, step);
    return;
  }
  if (rulePasses(scan.report, step.ruleId)) {
    passed(core, step);
    return;
  }
  // The watcher was seen and is gone without a pass: the 10 min cap. Wait 24 h before asking again.
  if (core.watchSeen && watching === null) {
    core.watchSeen = false;
    writeMemory(core, { waiting: { ...core.memory.waiting, [step.ruleId]: hoursAfter(core.now(), 24) } });
    advance(core, SHOW.expiredNotice);
  }
}

function passed(core: Core, step: ShowStep): void {
  core.scan.stopWatch();
  markFixed(core, [step.ruleId]);
  setStep(core, { kind: "done", line: guidedFor(step.ruleId).done, rows: [] });
}

/** "Check again" on a stale watcher: one free read of the watched sections. */
export function checkWatch(core: Core, step: ShowStep, bump: () => void): void {
  if (core.scan.scan.kind !== "ready") return;
  core.checking = true;
  void core.scan.recheck(step.watch).then(() => {
    core.checking = false;
    bump();
  });
}

export function settleWatchCheck(core: Core, step: ShowStep): void {
  const scan = core.scan.scan;
  if (scan.kind !== "ready") return;
  if (rulePasses(scan.report, step.ruleId)) passed(core, step);
}

/** The stale sentence after focus has been back for the grace period with no change. */
export function markStale(core: Core): void {
  const { phase } = core;
  if (phase.kind !== "step" || phase.state.kind !== "watching" || phase.state.stale) return;
  setStep(core, { ...phase.state, stale: true });
}
