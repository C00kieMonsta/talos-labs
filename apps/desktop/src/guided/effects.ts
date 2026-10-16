import { useEffect, useRef } from "react";
import type { ScanController } from "../scan/useScan";
import type { PermissionCardState } from "../scan/useCapabilityPoll";
import type { Core } from "./core";
import { advance, currentStep } from "./core";
import { landed, rebuilt } from "./landing";
import { batchLabel, settleBatch } from "./runBatch";
import { fixLabel, settleCheck, settleFix } from "./runFix";
import { markStale, observeWatch, settleWatchCheck } from "./runShow";
import { observePermission } from "./runPermission";
import { setStep } from "./core";
import type { GuidedDeps } from "./state";
import { STALE_AFTER_MS, autoAdvanceMs, paced } from "./timing";
import { lastReport } from "../scan/machine";

/** Phase transitions driven by the scan machine, the permission flow, focus and the clock. */
export function useGuidedEffects(core: Core, scan: ScanController, deps: GuidedDeps, card: PermissionCardState, bump: () => void): void {
  const state = scan.scan;
  const lastSeen = useRef(lastReport(state));
  if (state.kind !== "collecting" && state.kind !== "evaluating" && state.kind !== "presenting") lastSeen.current = lastReport(state);

  // Scan-driven transitions.
  useEffect(() => {
    const phase = core.phase;
    if (!deps.settings.onboarded) {
      if (phase.kind !== "welcome") core.setPhase({ kind: "welcome" });
      return;
    }
    if (state.kind === "collecting" || state.kind === "evaluating" || state.kind === "presenting") {
      if (!core.inScan) {
        core.inScan = true;
        core.previousReport = lastSeen.current ?? deps.loadedReport?.() ?? null;
      }
      if (phase.kind !== "scanning") core.setPhase({ kind: "scanning" });
      return;
    }
    const wasScanning = core.inScan;
    core.inScan = false;
    if (state.kind === "failed") {
      if (state.error === "cancelled") {
        if (phase.kind !== "stopped" || phase.cancelled !== true) core.setPhase({ kind: "stopped", cancelled: true });
      } else if (phase.kind !== "failed" || phase.error !== state.error) core.setPhase({ kind: "failed", error: state.error });
      return;
    }
    if (state.kind === "idle") {
      // A first check-up cancelled during its reveal leaves the machine idle with nothing held.
      if (wasScanning && phase.kind === "scanning") core.setPhase({ kind: "stopped", cancelled: true });
      else if (phase.kind === "welcome") core.setPhase({ kind: "scanning" });
      return;
    }
    const report = state.report;
    const fresh = phase.kind === "scanning" || phase.kind === "welcome" || phase.kind === "stopped" || phase.kind === "failed" || core.plannedReport === null;
    if (fresh) landed(core, report);
    else if (report !== core.plannedReport) rebuilt(core, report);
  }, [core, state, deps.settings.onboarded]);

  // The current step follows the fix, batch and watch state.
  useEffect(() => {
    const phase = core.phase;
    const step = currentStep(core);
    if (phase.kind !== "step" || step === null) return;
    const s = phase.state;
    if (state.kind !== "ready" && state.kind !== "rechecking") return;
    const fixing = state.kind === "ready" ? state.fixing : null;
    if (s.kind === "working" && !core.checking && fixing !== null) {
      if (fixing.kind === "batch" && step.kind === "batch") {
        if (fixing.phase === "done" || fixing.phase === "failed") settleBatch(core, step, fixing);
        else if (s.label !== batchLabel(fixing)) setStep(core, { kind: "working", label: batchLabel(fixing) });
      } else if (fixing.kind === "single" && step.kind === "fix") {
        if (fixing.phase === "done" || fixing.phase === "failed") settleFix(core, step, fixing);
        else if (s.label !== fixLabel(fixing)) setStep(core, { kind: "working", label: fixLabel(fixing) });
      }
      return;
    }
    if (s.kind === "working" && !core.checking && fixing === null && state.kind === "ready" && step.kind === "fix") settleCheck(core, step);
    if (s.kind === "watching" && step.kind === "show") {
      if (!core.checking) settleWatchCheck(core, step);
      observeWatch(core, step);
    }
  }, [core, state]);

  // The permission flow.
  useEffect(() => {
    const step = currentStep(core);
    if (step?.kind === "permission") observePermission(core, card);
  }, [core, card, core.phase]);

  // Auto-advance after a done line, paused while the window is unfocused.
  const phase = core.phase;
  const doneKey = phase.kind === "step" && phase.state.kind === "done" && phase.state.rows.every((r) => r.ok) ? `${phase.index}:${phase.state.line}` : null;
  useEffect(() => {
    if (doneKey === null || !deps.windowFocused) return;
    const timer = setTimeout(() => {
      if (core.phase.kind === "step" && core.phase.state.kind === "done") advance(core);
    }, autoAdvanceMs(deps.reducedMotion));
    return () => clearTimeout(timer);
  }, [core, doneKey, deps.windowFocused, deps.reducedMotion]);

  // A watcher with focus back for the grace period and no change reads as stale.
  const watchKey = phase.kind === "step" && phase.state.kind === "watching" && !phase.state.stale ? `${phase.index}:${phase.state.since}` : null;
  useEffect(() => {
    if (watchKey === null || !deps.windowFocused) return;
    const timer = setTimeout(() => markStale(core), paced(STALE_AFTER_MS));
    return () => clearTimeout(timer);
  }, [core, watchKey, deps.windowFocused]);

  void bump;
}
