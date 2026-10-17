import type { Core } from "./core";
import { currentStep, setStep } from "./core";
import { next } from "./actions";
import { startBatch } from "./runBatch";
import { checkAgain, convertToShow, startFix } from "./runFix";
import { checkWatch, startShow } from "./runShow";
import { reopenForPermission, startPermission } from "./runPermission";
import { watchActive } from "../app/gate";
import { failureCopy } from "./copy";
import { paneFor } from "./plan";

/** The one button of the current step, by step kind and state. */
export function primaryFor(core: Core, bump: () => void, openPermission: () => void): (passphrase?: string) => void {
  return (passphrase) => {
    const step = currentStep(core);
    const { phase } = core;
    if (step === null || phase.kind !== "step") return;
    const state = phase.state;
    if (state.kind === "working" || state.kind === "watching" && !state.stale || state.kind === "later_flash") return;
    if (state.kind === "done") {
      next(core);
      return;
    }
    switch (step.kind) {
      case "batch":
        if (state.kind === "failed") core.scan.dismissFix();
        startBatch(core, step, bump);
        return;
      case "fix": {
        if (state.kind === "failed") {
          const copy = failureCopy(state.error, false, paneFor(step.ruleId) !== null, watchActive(core.deps.settings, core.deps.gate));
          if (copy.primary === "next") return next(core);
          if (copy.primary === "show_where") return convertToShow(core, step);
          if (copy.primary === "check_again") return checkAgain(core, step, bump);
        }
        startFix(core, step, passphrase, bump);
        return;
      }
      case "show":
        if (state.kind === "watching") return checkWatch(core, step, bump);
        if (state.kind === "question") {
          setStep(core, { kind: "idle" });
        }
        startShow(core, step);
        return;
      case "permission":
        if (state.kind === "permission" && state.card === "reopen_needed") return reopenForPermission(core);
        if (state.kind === "idle") startPermission(core, openPermission);
        return;
      case "paywall":
        // The Buy button is wired by the screen; the key field settles through enterLicence.
        return;
    }
  };
}
