import type { GuidedStep } from "@talos/core";
import { convertedShowStep } from "@talos/core";
import type { FixingState } from "../scan/machine";
import { rulePasses } from "../scan/machine";
import type { Core } from "./core";
import { markFixed, replaceCurrentStep, setStep } from "./core";
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

/** Reads the settled single fix off the scan machine. */
export function settleFix(core: Core, step: FixStep, fixing: SingleFixing): void {
  core.scan.dismissFix();
  if (fixing.phase === "failed") {
    setStep(core, { kind: "failed", error: fixing.error ?? "command_failed", step: fixing.step, batch: false });
    return;
  }
  if (fixing.result === "pass") {
    markFixed(core, [step.ruleId]);
    setStep(core, { kind: "done", line: guidedFor(step.ruleId).done, rows: [] });
    return;
  }
  setStep(core, { kind: "failed", error: fixing.result ?? "still_failing", step: null, batch: false });
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

/** After the recheck landed: done when the rule passes, else still failing. */
export function settleCheck(core: Core, step: FixStep): void {
  const scan = core.scan.scan;
  if (scan.kind !== "ready") return;
  if (rulePasses(scan.report, step.ruleId)) {
    markFixed(core, [step.ruleId]);
    setStep(core, { kind: "done", line: guidedFor(step.ruleId).done, rows: [] });
  } else {
    setStep(core, { kind: "failed", error: "still_failing", step: null, batch: false });
  }
}

/** "Show me where" on a failed fix: the step becomes a show-me-where step with the same headline. */
export function convertToShow(core: Core, step: FixStep): void {
  const show = convertedShowStep(step.ruleId);
  if (show === null) return;
  replaceCurrentStep(core, show);
}
