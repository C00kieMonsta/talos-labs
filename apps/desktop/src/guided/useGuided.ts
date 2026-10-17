import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuidedMemory } from "@talos/core";
import { lastReport } from "../scan/machine";
import type { ScanController } from "../scan/useScan";
import { usePermissionFlow } from "../scan/useCapabilityPoll";
import { initialPermissionState } from "../components/PermissionCard";
import type { Core } from "./core";
import { currentStep } from "./core";
import * as act from "./actions";
import { buildChatBridge, stepDone } from "./chat-bridge";
import { useGuidedEffects } from "./effects";
import { rebuilt } from "./landing";
import { primaryFor } from "./primary";
import type { ChatBridge, GuidedController, GuidedDeps, GuidedPhase } from "./state";

export type { ChatBridge, ChatSettled, ChatSettledState, GuidedController, GuidedDeps, GuidedPhase, StepState } from "./state";

function sameKeys(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): boolean {
  const left = Object.keys(a);
  const right = Object.keys(b);
  return left.length === right.length && left.every((key) => key in b);
}

/** The guided controller: phase transitions, memory writes and timers on top of the scan machine. */
export function useGuided(scan: ScanController, deps: GuidedDeps): GuidedController {
  // With the automatic check-up off, the guide waits on its "Ready when you are." screen instead of a spinner.
  const [phase, setPhaseState] = useState<GuidedPhase>(() => (!deps.settings.onboarded ? { kind: "welcome" } : deps.settings.guided.autoScan ? { kind: "scanning" } : { kind: "stopped" }));
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
      paywallMoved: false,
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
  // A memory that is neither the one held nor the one last saved was changed elsewhere (the Settings reset, Details).
  // When its accepted set differs from the one held, the plan is rebuilt below; an aiAskedAt write alone is not.
  const rebuildFor = useRef<GuidedMemory | null>(null);
  if (deps.memory !== core.memory && deps.memory !== core.lastSaved) {
    if (!sameKeys(core.memory.accepted, deps.memory.accepted)) rebuildFor.current = deps.memory;
    core.memory = deps.memory;
  }
  useEffect(() => {
    if (rebuildFor.current !== deps.memory) return;
    rebuildFor.current = null;
    const report = lastReport(core.scan.scan);
    if (report !== null) rebuilt(core, report);
  }, [core, deps.memory]);

  const bump = useCallback(() => {
    if (core.phase.kind === "step" || core.phase.kind === "chat") core.setPhase({ ...core.phase });
  }, [core]);

  const flow = usePermissionFlow("full_disk_access", initialPermissionState("full_disk_access", deps.capabilitiesNow), {
    capabilities: () => deps.capabilities(),
    openPane: (kind) => deps.openPane(kind),
    recheck: (sections) => scan.recheck(sections),
    collectSection: (key) => deps.collectSection(key),
    restart: () => deps.restart(),
  });

  const primary = useCallback((passphrase?: string) => primaryFor(core, bump, flow.open)(passphrase), [core, bump, flow.open]);
  // The bridge's functions are built once over the core ref; its readonly fields follow the phase below.
  const permissionRef = useRef(flow.state);
  permissionRef.current = flow.state;
  const bridgeFns = useRef<ReturnType<typeof buildChatBridge> | null>(null);
  if (bridgeFns.current === null) bridgeFns.current = buildChatBridge(core, bump, flow.open, () => permissionRef.current);
  const chat = useMemo<ChatBridge>(() => {
    const fns = bridgeFns.current as ReturnType<typeof buildChatBridge>;
    const inChat = phase.kind === "chat";
    return {
      ...fns,
      plan: inChat ? phase.plan : null,
      diff: inChat ? phase.diff : null,
      resumed: inChat && phase.resumed,
      active: inChat ? phase.active : null,
      walking: inChat && phase.walking,
      fixed: [...core.fixed],
      leftAlone: [...core.leftAlone],
      doneStepIds: inChat ? phase.plan.steps.filter((s) => stepDone(core, s, flow.state)).map((s) => s.id) : [],
      permission: flow.state,
    };
    // stepDone reads the report and the memory, so the list follows every report change and every memory write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, core, flow.state, scan.scan, core.memory, deps.memory]);

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
    if (phase.kind === "chat") return { done: chat.doneStepIds.length, of: Math.max(core.ofFloor, phase.plan.steps.length) };
    return { done: 0, of: 0 };
  }, [phase, core, chat]);

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
      doNext: (action) => act.doNext(core, action, () => primary()),
      goToPaywall: () => act.goToPaywall(core),
      keepAsking: () => act.keepAsking(core),
      accept: () => act.accept(core),
      chat,
    }),
    [phase, progress, core, primary, chat],
  );
}
