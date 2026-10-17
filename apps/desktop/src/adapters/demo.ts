import type {
  AiAvailability,
  AutomationStatus,
  Capabilities,
  CollectOptions,
  CollectSectionOptions,
  ExplainerFailure,
  ExplainerPort,
  LicensePayload,
  LicensePort,
  LicenseState,
  ReportStorePort,
  RuleId,
  ScanReport,
  SecretName,
  SecretStorePort,
  SectionKey,
  SettingsPane,
  SystemState,
  SystemStatePort,
  SystemStateSections,
} from "@talos/core";
import { ALL_UNAVAILABLE, DEV_MACHINE, FRESH_INSTALL, HARDENED, MACOS_CATALOG, SECTION_KEYS, WINDOWS_MINIMAL } from "@talos/core";
import type { WatchDemoFlags } from "../app/demo-boot";
import type { ExplainerProvider, ExplainerSettings } from "../settings";
import type { Adapters } from "./index";
import { DemoAiConnect, type DemoConnectOutcome } from "./demo-ai-connect";
import { DemoAppleExplainer, DemoExplainer } from "./demo-explainer";
import { DemoFixPort, type DemoBatchOutcome, type DemoFixOutcome } from "./demo-fix";
import { DemoProviderExplainer } from "./demo-provider-explainer";
import { DemoWatch } from "./demo-watch";
import { cancelled, recordDemoCall, wait } from "./demo-shared";
import { NoExplainer } from "./no-explainer";

export { DemoAiConnect, DEFAULT_CONNECT_DELAY_MS, DEMO_CONNECT_OUTCOMES, type DemoConnectOutcome } from "./demo-ai-connect";
export { DemoAppleExplainer, DemoExplainer, DEMO_WORD_CHUNK_MS } from "./demo-explainer";
export { DemoProviderExplainer } from "./demo-provider-explainer";
export { DemoFixPort, DEMO_BATCH_OUTCOMES, DEMO_FIX_OUTCOMES, type DemoBatchOutcome, type DemoFixOutcome } from "./demo-fix";
export { recordDemoCall } from "./demo-shared";
export { DemoWatch, DEFAULT_WATCH_DELAY_MS, DEMO_WATCH_PLAN_TTL_MS } from "./demo-watch";

/**
 * Fixture-backed adapters so the web build runs in a plain browser for QA.
 * Nothing here reaches Tauri, the keychain, the filesystem or the network.
 * Only reachable when the bundle was built with VITE_TALOS_DEMO=1; see docs/SECURITY-MODEL.md.
 */

export type DemoFixture = "dev-machine" | "hardened" | "all-unavailable" | "fresh-install" | "windows-minimal";

export const DEMO_FIXTURES: Readonly<Record<DemoFixture, SystemState>> = {
  "dev-machine": DEV_MACHINE,
  hardened: HARDENED,
  "all-unavailable": ALL_UNAVAILABLE,
  "fresh-install": FRESH_INSTALL,
  "windows-minimal": WINDOWS_MINIMAL,
};

export const DEMO_FIXTURE_NAMES: readonly DemoFixture[] = ["dev-machine", "hardened", "all-unavailable", "fresh-install", "windows-minimal"];

export interface DemoOptions {
  readonly fixture: DemoFixture;
  /** When set, every in-app explainer call fails with this reason. */
  readonly explainerFailure?: ExplainerFailure | null;
  /** Pause per section while collecting, so the Scanning screen is visible. */
  readonly collectDelayMs?: number;
  readonly fix?: DemoFixOutcome;
  readonly batch?: DemoBatchOutcome;
  readonly fixDelayMs?: number;
  /** The first collect rejects with this ScanError kind; the next one succeeds. */
  readonly scanError?: DemoScanError | null;
  /** A report stored before boot, so the first check-up has something to diff against. */
  readonly previousReport?: ScanReport | null;
  readonly ai?: AiAvailability;
  readonly aiReadyMs?: number | null;
  /** fullDiskAccess turns true on this capability poll. */
  readonly fdaAfter?: number | null;
  readonly automation?: AutomationStatus | null;
  /** false shows the dev-build Full Disk Access hint; defaults to true. */
  readonly bundled?: boolean;
  /** A watched section passes on this poll. */
  readonly pollAfter?: number | null;
  /** Rules forced to fail on the fixture; only TL-MAC-013 is supported (a 60 minute screen saver). */
  readonly fail?: readonly RuleId[];
  /** The provider the URL seeded; the fake ChatGPT or Claude explainer starts in `ai`. */
  readonly provider?: ExplainerProvider;
  /** ISO shown with limit_reached. */
  readonly aiUntil?: string;
  /** How a demo sign-in ends. */
  readonly connect?: DemoConnectOutcome;
  /** Wait per connect stage. */
  readonly connectDelayMs?: number;
  /** The Claude sign-in shows the fetching stage first. */
  readonly claudeFetch?: boolean;
  /** The watch window and fishy flow state; absent gives a calm, enabled watch with nothing to show. */
  readonly watchDemo?: WatchDemoFlags;
}

/** No ?watch= params: the same as DEFAULT_WATCH_DEMO in demo-boot.ts, kept here so demo.ts imports no value from it. */
const NO_WATCH_DEMO: WatchDemoFlags = { watch: null, fishy: null, fishyGate: false, fishyWired: false, watchAi: null, ransomNote: false, licensed: false };

export type DemoScanError = "collector_crashed" | "timeout" | "schema_mismatch";
export const DEMO_SCAN_ERRORS: readonly DemoScanError[] = ["collector_crashed", "timeout", "schema_mismatch"];

/** Thrown once by the demo collect when scan_error is set; carries `kind` like the Tauri adapter's ScanError. */
export class DemoScanFailure extends Error {
  constructor(readonly kind: DemoScanError) {
    super(kind);
    this.name = "DemoScanFailure";
  }
}

export const DEFAULT_COLLECT_DELAY_MS = 120;
export const DEMO_EXPLAIN_DELAY_MS = 300;
export const DEFAULT_FIX_DELAY_MS = 400;
/** How long the loginItems row waits when automation=not_determined, so the prompting copy can be seen. */
export const DEMO_PROMPT_HOLD_MS = 9000;

/** The key for typed entry. */
export const DEMO_LICENSE_KEY = "TL1.DEMO";
/** Matches LicenceField's paste regex, so pasting it verifies without a button press. */
export const DEMO_LICENSE_KEY_PASTED = `TL1.${"DEMO".repeat(5)}.${"D".repeat(64)}`;

export const DEMO_LICENSE_PAYLOAD: LicensePayload = {
  v: 1,
  lid: "demo",
  product: "talos-desktop",
  plan: "personal",
  seats: 1,
  issuedAt: "2026-10-15",
  updatesUntil: "2099-12-31",
  tag: "deadbeef",
};

/** A fixture variant where the named rules fail; only the screen saver rule has a cheap failing shape. */
export function withForcedFailures(state: SystemState, fail: readonly RuleId[]): SystemState {
  if (!fail.includes("TL-MAC-013") || state.sections.screenLock.status !== "ok") return state;
  const screenLock = { ...state.sections.screenLock, data: { ...state.sections.screenLock.data, screensaverIdleSeconds: 3600 } };
  return { ...state, sections: { ...state.sections, screenLock } };
}

/** The fixture with every section swapped in from HARDENED as fixes land or watched sections pass. */
export class DemoSystemState implements SystemStatePort {
  private sections: SystemStateSections;
  private polls = 0;
  private pendingFailure: DemoScanError | null;
  private readonly sectionPolls = new Map<SectionKey, number>();

  constructor(
    state: SystemState,
    private readonly delayMs: number,
    private readonly options: Pick<DemoOptions, "fdaAfter" | "automation" | "bundled" | "pollAfter" | "fail" | "scanError"> = {},
  ) {
    this.pendingFailure = options.scanError ?? null;
    this.state = withForcedFailures(state, options.fail ?? []);
    this.sections = this.state.sections;
  }

  private readonly state: SystemState;

  /** Replaces `keys` with their passing variants, so the next read turns green. */
  pass(keys: readonly SectionKey[]): void {
    const next = { ...this.sections } as Record<SectionKey, unknown>;
    for (const key of keys) next[key] = HARDENED.sections[key];
    this.sections = next as SystemStateSections;
  }

  private current(): SystemState {
    return this.sections === this.state.sections ? this.state : { ...this.state, sections: this.sections };
  }

  async collect(options?: CollectOptions): Promise<SystemState> {
    const signal = options?.signal;
    if (signal?.aborted) throw cancelled();
    if (this.pendingFailure !== null) {
      const kind = this.pendingFailure;
      this.pendingFailure = null;
      await wait(this.delayMs, signal);
      throw new DemoScanFailure(kind);
    }
    for (const key of SECTION_KEYS) {
      options?.onProgress?.({ key, status: "started" });
      // An unasked Automation permission holds loginItems the way the real osascript prompt does.
      if (key === "loginItems" && this.options.automation === "not_determined") await wait(DEMO_PROMPT_HOLD_MS, signal);
      await wait(this.delayMs, signal);
      const status = this.sections[key].status === "ok" ? "ok" : "unavailable";
      options?.onProgress?.({ key, status });
    }
    return this.current();
  }

  async collectSection<K extends SectionKey>(key: K, options?: CollectSectionOptions): Promise<SystemStateSections[K]> {
    await wait(this.delayMs, options?.signal);
    const count = (this.sectionPolls.get(key) ?? 0) + 1;
    this.sectionPolls.set(key, count);
    const after = this.options.pollAfter;
    if (typeof after === "number" && count >= after) this.pass([key]);
    return this.sections[key];
  }

  async capabilities(): Promise<Capabilities> {
    this.polls += 1;
    const after = this.options.fdaAfter;
    return {
      fullDiskAccess: typeof after === "number" && this.polls >= after,
      automation: this.options.automation ?? null,
      bundled: this.options.bundled ?? true,
    };
  }
}

export class DemoLicense implements LicensePort {
  private state: LicenseState = { status: "none" };

  async current(): Promise<LicenseState> {
    return this.state;
  }

  async install(key: string): Promise<LicenseState> {
    const trimmed = key.trim();
    if (trimmed !== DEMO_LICENSE_KEY && trimmed !== DEMO_LICENSE_KEY_PASTED) return { status: "invalid", reason: "signature" };
    this.state = { status: "valid", payload: DEMO_LICENSE_PAYLOAD };
    return this.state;
  }

  async remove(): Promise<void> {
    this.state = { status: "none" };
  }
}

export class DemoSecretStore implements SecretStorePort {
  private readonly values = new Map<SecretName, string>();

  async get(name: SecretName): Promise<string | null> {
    return this.values.get(name) ?? null;
  }

  async set(name: SecretName, value: string): Promise<void> {
    this.values.set(name, value);
  }

  async delete(name: SecretName): Promise<void> {
    this.values.delete(name);
  }
}

export class DemoReportStore implements ReportStorePort {
  private last: ScanReport | null;

  constructor(previous: ScanReport | null = null) {
    this.last = previous;
  }

  async saveLast(report: ScanReport): Promise<void> {
    this.last = report;
  }

  async loadLast(): Promise<ScanReport | null> {
    return this.last;
  }

  async current(): Promise<ScanReport | null> {
    return this.last;
  }
}

export async function demoOpenSettingsPane(pane: SettingsPane): Promise<void> {
  recordDemoCall({ kind: "openSettingsPane", arg: pane });
}

export async function demoRestart(): Promise<void> {
  recordDemoCall({ kind: "restart" });
}

export function createDemoAdapters(options: DemoOptions): Adapters {
  const state = DEMO_FIXTURES[options.fixture];
  const delay = options.collectDelayMs ?? DEFAULT_COLLECT_DELAY_MS;
  const failure = options.explainerFailure ?? null;
  const systemState = new DemoSystemState(state, delay, options);
  // `ai` seeds whichever provider the URL named; the Apple fake reads it only when that is apple (or nothing).
  const seedsApple = options.provider === undefined || options.provider === "apple";
  const apple = new DemoAppleExplainer({
    catalog: MACOS_CATALOG,
    availability: seedsApple ? (options.ai ?? "available") : "available",
    readyAfterMs: options.aiReadyMs ?? null,
    failure,
  });
  const aiConnect = new DemoAiConnect(options);
  const providers: Record<"chatgpt" | "claude_plan", DemoProviderExplainer> = {
    chatgpt: new DemoProviderExplainer("chatgpt", { catalog: MACOS_CATALOG, connect: aiConnect, failure }),
    claude_plan: new DemoProviderExplainer("claude_plan", { catalog: MACOS_CATALOG, connect: aiConnect, failure }),
  };
  return {
    systemState,
    license: new DemoLicense(),
    secrets: new DemoSecretStore(),
    reports: new DemoReportStore(options.previousReport ?? null),
    fixes: new DemoFixPort({
      catalog: MACOS_CATALOG,
      outcome: options.fix ?? "ok",
      batch: options.batch ?? "ok",
      delayMs: options.fixDelayMs ?? DEFAULT_FIX_DELAY_MS,
      onApplied: (keys) => systemState.pass(keys),
    }),
    openSettingsPane: demoOpenSettingsPane,
    restart: demoRestart,
    async createExplainer(settings: ExplainerSettings): Promise<ExplainerPort> {
      if (!settings.aiEnabled) return new NoExplainer();
      switch (settings.provider) {
        case "apple":
          return apple;
        case "chatgpt":
        case "claude_plan":
          return providers[settings.provider];
        case "claude":
        case "ollama":
          return new DemoExplainer(settings.provider, MACOS_CATALOG, failure, DEMO_EXPLAIN_DELAY_MS);
      }
    },
    aiConnect,
    watch: new DemoWatch(options.watchDemo ?? NO_WATCH_DEMO, options.fixDelayMs ?? DEFAULT_FIX_DELAY_MS),
  };
}
