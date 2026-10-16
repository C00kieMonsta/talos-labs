import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScanController } from "../scan/useScan";
import { usePermissionFlow } from "../scan/useCapabilityPoll";
import { initialPermissionState } from "../components/PermissionCard";
import type { Core } from "./core";
import { currentStep } from "./core";
import * as act from "./actions";
import { useGuidedEffects } from "./effects";
import { primaryFor } from "./primary";
import type { GuidedController, GuidedDeps, GuidedPhase } from "./state";

export type { GuidedController, GuidedDeps, GuidedPhase, StepState } from "./state";

/** The guided controller: phase transitions, memory writes and timers on top of the scan machine. */
export function useGuided(scan: ScanController, deps: GuidedDeps): GuidedController {
  const [phase, setPhaseState] = useState<GuidedPhase>(() => (deps.settings.onboarded ? { kind: "scanning" } : { kind: "welcome" }));
  const coreRef = useRef<Core | null>(null);
  if (coreRef.current === null) {
    const core: Core = {
      phase,
      memory: deps.memory,
      lastSaved: null,
      deps,
      scan,
      extras: [],
      leftAlone: new Set(),
      fixed: [],
      previousReport: null,
      plannedReport: null,
      ofFloor: 0,
      batchFailures: 0,
      watchSeen: false,
      resume: deps.resume === true,
      checking: false,
      inScan: false,
      setPhase: (next) => {
        core.phase = next;
        setPhaseState(next);
      },
      now: () => new Date().toISOString(),
    };
    coreRef.current = core;
  }
  const core = coreRef.current;
  core.deps = deps;
  core.scan = scan;
  // A memory that is neither the one held nor the one last saved was changed elsewhere (the Settings reset).
  if (deps.memory !== core.memory && deps.memory !== core.lastSaved) core.memory = deps.memory;

  const bump = useCallback(() => {
    if (core.phase.kind === "step") core.setPhase({ ...core.phase });
  }, [core]);

  const flow = usePermissionFlow("full_disk_access", initialPermissionState("full_disk_access", deps.capabilitiesNow), {
    capabilities: () => deps.capabilities(),
    openPane: (kind) => deps.openPane(kind),
    recheck: (sections) => scan.recheck(sections),
    collectSection: (key) => deps.collectSection(key),
    restart: () => deps.restart(),
  });

  const primary = useCallback((passphrase?: string) => primaryFor(core, bump, flow.open)(passphrase), [core, bump, flow.open]);

  useGuidedEffects(core, scan, deps, flow.state, bump);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || core.phase.kind !== "step") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, a, input, textarea, select, summary") !== null) return;
      if (currentStep(core) === null || core.phase.state.kind !== "idle") return;
      primary();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [core, primary]);

  const progress = useMemo(() => {
    if (phase.kind === "step") return { done: phase.index, of: Math.max(core.ofFloor, phase.plan.steps.length) };
    if (phase.kind === "end") return { done: phase.plan.steps.length, of: Math.max(core.ofFloor, phase.plan.steps.length) };
    if (phase.kind === "plan" || phase.kind === "since") return { done: 0, of: phase.plan.steps.length };
    return { done: 0, of: 0 };
  }, [phase, core]);

  return useMemo<GuidedController>(
    () => ({
      phase,
      progress,
      start: () => act.start(core),
      carryOn: () => act.carryOn(core),
      primary,
      later: () => act.later(core),
      next: () => act.next(core),
      answer: (_question, yes) => act.answer(core, yes, () => primary()),
      toggleList: () => act.toggleList(core),
      enterLicence: async () => act.licenceAccepted(core),
    }),
    [phase, progress, core, primary],
  );
}
