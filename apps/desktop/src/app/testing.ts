import { vi } from "vitest";
import { createElement, useState } from "react";
import type { ReactNode } from "react";
import type {
  BatchOutcome,
  BatchPlan,
  Capabilities,
  ExplainerPort,
  Finding,
  FixPlan,
  FixPort,
  LicenseState,
  RuleCatalog,
  RuleId,
  ScanReport,
  SectionKey,
  SystemState,
  SystemStatePort,
  SystemStateSections,
} from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, SECTION_KEYS } from "@talos/core";
import type { Adapters } from "../adapters";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import type { AppContextValue } from "./context";
import type { Gate } from "./gate";
import type { ScanState } from "../scan/machine";
import type { AskMessage, ScanController } from "../scan/useScan";
import { AppContext } from "./context";

/** Test doubles for everything the screens touch. Nothing here reaches Tauri. */

export const noExplainer: ExplainerPort = {
  id: "none",
  availability: async () => "off",
  explain: async () => ({ ok: false, reason: "not_configured" }),
  prioritise: async () => ({ ok: false, reason: "not_configured" }),
  ask: async () => ({ ok: false, reason: "not_configured" }),
};

/** collect returns `state`; collectSection reads from `sectionSource` so a recheck can observe a change. */
export function fakeSystemState(
  state: SystemState = DEV_MACHINE,
  overrides: Partial<SystemStatePort> = {},
  sectionSource: SystemState = state,
): SystemStatePort {
  return {
    collect: vi.fn(async () => state),
    collectSection: vi.fn(
      async <K extends SectionKey>(key: K) => sectionSource.sections[key] as SystemStateSections[K],
    ),
    capabilities: vi.fn(async (): Promise<Capabilities> => ({ fullDiskAccess: false, automation: "granted", bundled: true })),
    ...overrides,
  };
}

export function fakeAdapters(overrides: Partial<Adapters> = {}, state: SystemState = DEV_MACHINE): Adapters {
  return {
    systemState: fakeSystemState(state),
    license: {
      current: vi.fn(async (): Promise<LicenseState> => ({ status: "none" })),
      install: vi.fn(async (): Promise<LicenseState> => ({ status: "invalid", reason: "format" })),
      remove: vi.fn(async () => undefined),
    },
    secrets: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    reports: {
      saveLast: vi.fn(async () => undefined),
      loadLast: vi.fn(async (): Promise<ScanReport | null> => null),
    },
    fixes: fakeFixPort(),
    openSettingsPane: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    createExplainer: vi.fn(async () => noExplainer),
    ...overrides,
  };
}

export function fakeScanController(scan: ScanState): ScanController {
  return {
    scan,
    notice: null,
    dismissNotice: vi.fn(),
    dismissFailure: vi.fn(),
    loadLast: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    cancel: vi.fn(),
    recheck: vi.fn(async () => undefined),
    explain: vi.fn(async () => undefined),
    prioritise: vi.fn(async () => undefined),
    ask: vi.fn(async () => ({ ok: false as const, reason: "not_configured" as const })),
    stopExplain: vi.fn(),
    revealRow: vi.fn(),
    markPreparing: vi.fn(),
    present: vi.fn(async () => undefined),
    previewFix: vi.fn(async () => undefined),
    applyFix: vi.fn(async () => undefined),
    previewBatch: vi.fn(async () => undefined),
    applyBatch: vi.fn(async () => undefined),
    cancelFix: vi.fn(),
    dismissFix: vi.fn(),
    startWatch: vi.fn(),
    stopWatch: vi.fn(),
    reveal: vi.fn(async () => undefined),
    conversation: [],
    setConversation: vi.fn(),
    draft: "",
    setDraft: vi.fn(),
  };
}

export function fakeContextValue(input: {
  adapters: Adapters;
  license: LicenseState;
  gate: Gate;
  scanState: ScanState | { kind: "idle"; report: null; last: ScanReport | null };
  settings?: AppSettings;
  catalog?: RuleCatalog;
}): AppContextValue {
  const scanState: ScanState =
    input.scanState.kind === "idle" ? { kind: "idle", last: input.scanState.last } : input.scanState;
  return {
    adapters: input.adapters,
    catalog: input.catalog ?? MACOS_CATALOG,
    settings: input.settings ?? { ...DEFAULT_SETTINGS, onboarded: true },
    updateSettings: vi.fn(),
    license: input.license,
    setLicense: vi.fn(),
    gate: input.gate,
    scan: fakeScanController(scanState),
    router: { route: { name: "overview" }, lastMove: "navigate", navigate: vi.fn(), back: vi.fn(), replace: vi.fn() },
    aiUsable: false,
    ai: { availability: null, probe: vi.fn(async () => "off" as const), reprobe: vi.fn(() => () => undefined) },
    capabilities: null,
    refreshCapabilities: vi.fn(async () => null),
  };
}

/** A provider whose licence, settings and Ask conversation are real React state, so a screen re-renders after writing through the context. */
export function StatefulProvider({ value, children }: { value: AppContextValue; children?: ReactNode }) {
  const [license, setLicense] = useState<LicenseState>(value.license);
  const [settings, setSettings] = useState<AppSettings>(value.settings);
  const [conversation, setConversation] = useState<readonly AskMessage[]>(value.scan.conversation);
  const [draft, setDraft] = useState(value.scan.draft);
  const live: AppContextValue = {
    ...value,
    license,
    setLicense,
    settings,
    updateSettings: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
    scan: { ...value.scan, conversation, setConversation, draft, setDraft },
  };
  return createElement(AppContext.Provider, { value: live }, children);
}

/** A small hand-built report so screen tests do not depend on the engine. */
export function fakeFinding(overrides: Partial<Finding> & Pick<Finding, "ruleId" | "status">): Finding {
  return {
    title: `Check ${overrides.ruleId}`,
    headline: overrides.status === "unknown" ? `Couldn't check ${overrides.ruleId}` : `Fix ${overrides.ruleId}`,
    guided: { headline: "Fix this", why: "It matters.", verb: "Fix it for me", done: "Done. Fixed.", where: null },
    severity: "high",
    category: "network",
    cis: null,
    requires: ["firewall"],
    evidence: [],
    unknownReason: null,
    points: overrides.status === "fail" ? 8 : 0,
    explanation: "Authored explanation.",
    fix: {
      summary: "Turn it on.",
      settingsPath: ["System Settings", "Network", "Firewall"],
      settingsPane: "firewall",
      commands: [],
      steps: ["Open the pane.", "Switch it on."],
      verify: "The toggle reads On.",
      effort: "two_minutes",
      sideEffects: "none",
      apply: {
        kind: "in_app",
        choice: "none",
        passphrase: false,
        needsPassword: true,
        recheck: ["firewall"],
        confirmTitle: "Turn the firewall on?",
        confirmVerb: "Turn on",
        confirmNote: null,
        reversible: "You can switch it off again in System Settings > Network > Firewall.",
      },
    },
    ...overrides,
  };
}

export function fakeReport(findings: readonly Finding[], passes: readonly RuleId[] = []): ScanReport {
  const sections = {} as Record<SectionKey, { status: "ok" }>;
  for (const key of SECTION_KEYS) sections[key] = { status: "ok" };
  const counts = { pass: passes.length, fail: 0, review: 0, unknown: 0, not_applicable: 0 };
  for (const f of findings) counts[f.status] += 1;
  const deducted = findings.reduce((sum, f) => sum + f.points, 0);
  const value = Math.max(0, 100 - deducted);
  return {
    schemaVersion: 1,
    reportId: "fake",
    scannedAt: "2026-10-15T10:00:00.000Z",
    collectedAt: DEV_MACHINE.collectedAt,
    coreVersion: "0.1.0",
    catalogVersion: "0.2.0",
    cisEdition: "test edition",
    platform: DEV_MACHINE.host,
    sections,
    score: {
      value,
      grade: value >= 90 ? "good" : value >= 70 ? "fair" : value >= 40 ? "poor" : "at_risk",
      deducted,
      cappedByCritical: false,
      complete: counts.unknown === 0,
      counts,
    },
    results: [
      ...passes.map((ruleId) => ({ ruleId, status: "pass" as const, evidence: [], unknownReason: null, points: 0 })),
      ...findings.map((f) => ({ ruleId: f.ruleId, status: f.status, evidence: f.evidence, unknownReason: f.unknownReason, points: f.points })),
    ],
    findings,
  };
}

export function fakePlan(overrides: Partial<FixPlan> = {}): FixPlan {
  return {
    planId: "plan-1",
    ruleId: "TL-MAC-001",
    lines: [{ text: "/usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on", privilege: "admin" }],
    needsPassword: true,
    needsPassphrase: false,
    recheck: ["firewall"],
    reversible: "You can switch it off again in System Settings > Network > Firewall.",
    previous: null,
    expiresAt: "2026-10-15T10:05:00.000Z",
    ...overrides,
  };
}

/** A batch over the firewall and the two sharing rules, as the licensed dev-machine plan builds. */
export function fakeBatchPlan(overrides: Partial<BatchPlan> = {}): BatchPlan {
  return {
    planId: "batch-1",
    items: [
      { ruleId: "TL-MAC-002", lines: [{ text: "/usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on", privilege: "admin" }], recheck: ["firewall"], previous: null },
      { ruleId: "TL-MAC-003", lines: [{ text: "/usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode on", privilege: "admin" }], recheck: ["firewall"], previous: null },
    ],
    excluded: [],
    needsPassword: true,
    recheck: ["firewall"],
    expiresAt: "2026-10-15T10:05:00.000Z",
    ...overrides,
  };
}

/** A fix port whose preview returns `plan` and whose apply succeeds at once. */
export function fakeFixPort(plan: FixPlan = fakePlan(), overrides: Partial<FixPort> = {}): FixPort {
  return {
    preview: vi.fn(async () => plan),
    apply: vi.fn(async () => ({ ok: true as const })),
    previewBatch: vi.fn(async () => fakeBatchPlan()),
    applyBatch: vi.fn(async (): Promise<BatchOutcome> => ({ ok: true, items: [], error: null })),
    reveal: vi.fn(async () => undefined),
    openBuyPage: vi.fn(async () => undefined),
    ...overrides,
  };
}
