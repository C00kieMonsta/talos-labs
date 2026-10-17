import type { GuidedStep, RuleId } from "@talos/core";
import { convertedShowStep } from "@talos/core";
import type { FixingState } from "../scan/machine";
import { rulePasses } from "../scan/machine";
import type { Core } from "./core";
import { markFixed, replaceCurrentStep, setStep } from "./core";
import type { StepState } from "./state";
import { STATUS } from "./copy";
import { findingFor, guidedFor } from "./plan";

type FixStep = Extract<GuidedStep, { kind: "fix" }>;
type SingleFixing = Extract<FixingState, { kind: "single" }>;

/** The step's verb: preview then apply, no sheet. 029 passes the typed passphrase. */
export function startFix(core: Core, step: FixStep, passphrase: string | undefined, bump: () => void): void {
  setStep(core, { kind: "working", label: STATUS.preparing });
  void (async () => {
    await core.scan.previewFix(step.ruleId, step.choice);
    await core.scan.applyFix(passphrase);
    bump();
  })();
}

export function fixLabel(fixing: SingleFixing): string {
  switch (fixing.phase) {
    case "confirm":
      return STATUS.preparing;
    case "waiting_for_password":
      return STATUS.password;
    case "running":
      return STATUS.working;
    default:
      return STATUS.checking;
  }
}

export type SettledState = Extract<StepState, { kind: "done" | "failed" }>;

/** The settled single fix as the step's state, pure: the walk-through and the chat both read it. */
export function readFixOutcome(step: FixStep, fixing: SingleFixing): { state: SettledState; fixed: readonly RuleId[] } {
  if (fixing.phase === "failed") return { state: { kind: "failed", error: fixing.error ?? "command_failed", step: fixing.step, batch: false }, fixed: [] };
  if (fixing.result === "pass") return { state: { kind: "done", line: guidedFor(step.ruleId).done, rows: [] }, fixed: [step.ruleId] };
  return { state: { kind: "failed", error: fixing.result ?? "still_failing", step: null, batch: false }, fixed: [] };
}

/** Reads the settled single fix off the scan machine into the current step. */
export function settleFix(core: Core, step: FixStep, fixing: SingleFixing): void {
  core.scan.dismissFix();
  const { state, fixed } = readFixOutcome(step, fixing);
  markFixed(core, fixed);
  setStep(core, state);
}

/** "Check again" after still_failing: one more read of the sections the apply re-read. */
export function checkAgain(core: Core, step: FixStep, bump: () => void): void {
  const scan = core.scan.scan;
  if (scan.kind !== "ready") return;
  const finding = findingFor(scan.report, step.ruleId);
  const sections = finding?.fix.apply.kind === "in_app" ? finding.fix.apply.recheck : [];
  core.checking = true;
  setStep(core, { kind: "working", label: STATUS.checking });
  void core.scan.recheck(sections).then(() => {
    core.checking = false;
    bump();
  });
}

/** After the recheck landed: done when the rule passes, else still failing. Pure; null when no report is held. */
export function readCheckOutcome(core: Core, step: FixStep): { state: SettledState; fixed: readonly RuleId[] } | null {
  const scan = core.scan.scan;
  if (scan.kind !== "ready") return null;
  if (rulePasses(scan.report, step.ruleId)) return { state: { kind: "done", line: guidedFor(step.ruleId).done, rows: [] }, fixed: [step.ruleId] };
  return { state: { kind: "failed", error: "still_failing", step: null, batch: false }, fixed: [] };
}

export function settleCheck(core: Core, step: FixStep): void {
  const read = readCheckOutcome(core, step);
  if (read === null) return;
  markFixed(core, read.fixed);
  setStep(core, read.state);
}

/** "Show me where" on a failed fix: the step becomes a show-me-where step with the same headline. */
export function convertToShow(core: Core, step: FixStep): void {
  const show = convertedShowStep(step.ruleId);
  if (show === null) return;
  replaceCurrentStep(core, show);
}
