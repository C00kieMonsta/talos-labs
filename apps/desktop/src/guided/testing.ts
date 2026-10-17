import { vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Capabilities, GuidedMemory, ScanReport, SystemState } from "@talos/core";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, MACOS_CATALOG, evaluate } from "@talos/core";
import type { Adapters } from "../adapters";
import { buildGate } from "../app/gate";
import { fakeAdapters, noExplainer } from "../app/testing";
import { useScan } from "../scan/useScan";
import type { ScanDeps } from "../scan/useScan";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import { useGuided } from "./useGuided";
import type { ChatBridge, GuidedDeps } from "./state";

/** A bridge that does nothing: for controller literals in screen tests that never enter the chat. */
export const INERT_CHAT_BRIDGE: ChatBridge = {
  plan: null,
  diff: null,
  resumed: false,
  active: null,
  walking: false,
  fixed: [],
  leftAlone: [],
  doneStepIds: [],
  permission: "not_granted",
  undone: () => [],
  nextUndone: () => null,
  atEnd: () => true,
  run: () => undefined,
  checkAgain: async () => null,
  settle: () => null,
  observeShow: () => null,
  watchingSince: () => null,
  later: () => [],
  accept: () => undefined,
  answerNo: () => undefined,
  leaveAlone: () => undefined,
  snoozePaywall: () => undefined,
  unlock: () => [],
  setWalking: () => undefined,
  stepByStep: () => undefined,
  leaveChat: () => undefined,
  toChat: () => undefined,
  rescan: () => undefined,
};

/** Test doubles for the guided controller over a real scan machine. */

export const NOW = "2026-10-16T10:00:00.000Z";

export function reportFor(state: SystemState): ScanReport {
  return evaluate(state, MACOS_CATALOG, { now: NOW, os: "macos" });
}

export interface HarnessOptions {
  readonly adapters?: Adapters;
  readonly licensed?: boolean;
  readonly settings?: Partial<AppSettings>;
  readonly memory?: GuidedMemory;
  readonly loadedReport?: ScanReport | null;
  readonly reducedMotion?: boolean;
  readonly resume?: boolean;
}

export function renderGuided(options: HarnessOptions = {}) {
  const adapters = options.adapters ?? fakeAdapters();
  const scanDeps: ScanDeps = {
    adapters,
    engine: reportFor,
    createExplainer: async () => noExplainer,
    toContext: () => ({ findings: [], profile: DEFAULT_SETTINGS.profile }) as never,
  };
  const saved: GuidedMemory[] = [];
  const settings: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, ...options.settings };
  const control = {
    memory: options.memory ?? EMPTY_GUIDED_MEMORY,
    focused: true,
    capabilities: { fullDiskAccess: false, automation: "granted", bundled: true } as Capabilities,
    openPane: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
  };
  const hook = renderHook(() => {
    const scan = useScan(scanDeps);
    const report = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.report : null;
    const gate = buildGate(report, options.licensed === true ? { status: "valid", payload: { v: 1, lid: "L", product: "talos-desktop", plan: "personal", seats: 1, issuedAt: "2026-01-01", updatesUntil: "2027-01-01", tag: "t" } } : { status: "none" });
    const deps: GuidedDeps = {
      gate,
      settings,
      memory: control.memory,
      saveMemory: (next) => {
        control.memory = next;
        saved.push(next);
      },
      capabilitiesNow: control.capabilities,
      capabilities: async () => control.capabilities,
      openPane: control.openPane,
      collectSection: async () => undefined,
      restart: control.restart,
      reducedMotion: options.reducedMotion === true,
      windowFocused: control.focused,
      resume: options.resume === true,
      loadedReport: () => options.loadedReport ?? null,
    };
    const guided = useGuided(scan, deps);
    return { scan, guided, deps };
  });
  return { hook, adapters, saved, control };
}

export { DEV_MACHINE };
