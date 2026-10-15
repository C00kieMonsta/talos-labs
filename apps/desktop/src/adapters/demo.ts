import type {
  AbortSignalLike,
  Answer,
  AskInput,
  Capabilities,
  CollectOptions,
  CollectSectionOptions,
  ExplainInput,
  ExplainerContext,
  ExplainerFailure,
  ExplainerFinding,
  ExplainerPort,
  ExplainerResult,
  Explanation,
  LicensePayload,
  LicensePort,
  LicenseState,
  Prioritisation,
  PrioritiseInput,
  ReportStorePort,
  Rule,
  RuleCatalog,
  RuleId,
  ScanReport,
  SecretName,
  SecretStorePort,
  SectionKey,
  SettingsPane,
  Severity,
  SystemState,
  SystemStatePort,
  SystemStateSections,
} from "@talos/core";
import {
  ALL_UNAVAILABLE,
  DEV_MACHINE,
  FRESH_INSTALL,
  HARDENED,
  MACOS_CATALOG,
  SECTION_KEYS,
  WINDOWS_MINIMAL,
} from "@talos/core";
import type { Assistant, ExplainerSettings } from "../settings";
import type { Adapters } from "./index";
import { NoExplainer } from "./no-explainer";

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

export const DEMO_FIXTURE_NAMES: readonly DemoFixture[] = [
  "dev-machine",
  "hardened",
  "all-unavailable",
  "fresh-install",
  "windows-minimal",
];

export interface DemoOptions {
  readonly fixture: DemoFixture;
  /** When set, every in-app explainer call fails with this reason. */
  readonly explainerFailure?: ExplainerFailure | null;
  /** Pause per section while collecting, so the Scanning screen is visible. */
  readonly collectDelayMs?: number;
}

export const DEFAULT_COLLECT_DELAY_MS = 120;
export const DEMO_EXPLAIN_DELAY_MS = 300;

/** The only key the demo licence accepts. */
export const DEMO_LICENSE_KEY = "TL1.DEMO";

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

function cancelled(): Error {
  return new Error("cancelled");
}

/** Resolves after ms, or rejects with "cancelled" as soon as the signal aborts. */
function wait(ms: number, signal?: AbortSignalLike): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort);
  });
}

export class DemoSystemState implements SystemStatePort {
  constructor(
    private readonly state: SystemState,
    private readonly delayMs: number,
  ) {}

  async collect(options?: CollectOptions): Promise<SystemState> {
    const signal = options?.signal;
    if (signal?.aborted) throw cancelled();
    for (const key of SECTION_KEYS) {
      options?.onProgress?.({ key, status: "started" });
      await wait(this.delayMs, signal);
      const status = this.state.sections[key].status === "ok" ? "ok" : "unavailable";
      options?.onProgress?.({ key, status });
    }
    return this.state;
  }

  async collectSection<K extends SectionKey>(key: K, options?: CollectSectionOptions): Promise<SystemStateSections[K]> {
    await wait(this.delayMs, options?.signal);
    return this.state.sections[key];
  }

  async capabilities(): Promise<Capabilities> {
    return { fullDiskAccess: false };
  }
}

export class DemoLicense implements LicensePort {
  private state: LicenseState = { status: "none" };

  async current(): Promise<LicenseState> {
    return this.state;
  }

  async install(key: string): Promise<LicenseState> {
    if (key.trim() !== DEMO_LICENSE_KEY) return { status: "invalid", reason: "signature" };
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
  private last: ScanReport | null = null;

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

/** Records what the app would have opened, for a QA script to read back. */
export function recordDemoCall(call: TalosDemoCall): void {
  if (typeof window === "undefined") return;
  const calls = window.__talosDemoCalls ?? [];
  calls.push(call);
  window.__talosDemoCalls = calls;
}

export async function demoOpenSettingsPane(pane: SettingsPane): Promise<void> {
  recordDemoCall({ kind: "openSettingsPane", arg: pane });
}

export async function demoOpenAssistant(assistant: Assistant, prompt: string): Promise<void> {
  recordDemoCall({ kind: "openAssistant", arg: assistant, prompt });
}

const URGENCY_BY_SEVERITY: Readonly<Record<Severity, Explanation["urgency"]>> = {
  critical: "today",
  high: "this_week",
  medium: "this_week",
  low: "when_convenient",
  info: "when_convenient",
};

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const STATUS_RANK: Readonly<Record<ExplainerFinding["status"], number>> = { fail: 0, review: 1, unknown: 2 };

const MAX_TEXT = 1200;

function firstSentence(text: string): string {
  const end = text.indexOf(". ");
  return end === -1 ? text : text.slice(0, end + 1);
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

function situation(context: ExplainerContext): string {
  const { profile } = context;
  const parts: string[] = [];
  if (profile.laptopLeavesHome) parts.push("this Mac leaves the house with you");
  if (profile.handlesClientData) parts.push("you keep other people's data on it");
  if (profile.role === "small_business") parts.push("your business runs on it");
  if (profile.role === "freelancer") parts.push("your work depends on it");
  return parts.length === 0 ? "you use this Mac for personal things" : parts.join(" and ");
}

function byPriority(a: ExplainerFinding, b: ExplainerFinding): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
}

/**
 * Canned but catalog-consistent answers that pass core's validators. The order it suggests is a
 * permutation of the context's finding ids and every text is free of command lines.
 */
export class DemoExplainer implements ExplainerPort {
  private readonly rulesById: ReadonlyMap<RuleId, Rule>;

  constructor(
    readonly id: "claude" | "ollama",
    catalog: RuleCatalog,
    private readonly failure: ExplainerFailure | null,
    private readonly delayMs: number,
  ) {
    this.rulesById = new Map(catalog.rules.map((rule) => [rule.id, rule]));
  }

  private async settle<T>(build: () => T): Promise<ExplainerResult<T>> {
    await wait(this.delayMs);
    if (this.failure !== null) return { ok: false, reason: this.failure };
    return { ok: true, value: build() };
  }

  explain(input: ExplainInput): Promise<ExplainerResult<Explanation>> {
    return this.settle(() => {
      const rule = this.rulesById.get(input.ruleId);
      const finding = input.context.findings.find((f) => f.ruleId === input.ruleId);
      const severity = finding?.severity ?? rule?.severity ?? "medium";
      const problem = rule?.failTitle ?? `Check ${input.ruleId} needs attention`;
      const why = rule === undefined ? "This setting protects the data on this Mac." : firstSentence(rule.explanation);
      return {
        ruleId: input.ruleId,
        whyItMattersForYou: clip(`${problem}. ${why} Because ${situation(input.context)}, this is worth sorting out.`),
        whatCouldHappen: clip(
          rule === undefined
            ? "Someone with access to this Mac, or to the network it is on, could get further than they should."
            : `${rule.explanation} The fix shown in the app takes ${rule.fix.effort === "two_minutes" ? "a couple of minutes" : rule.fix.effort === "ten_minutes" ? "about ten minutes" : "about half an hour"}.`,
        ),
        urgency: URGENCY_BY_SEVERITY[severity],
      };
    });
  }

  prioritise(input: PrioritiseInput): Promise<ExplainerResult<Prioritisation>> {
    return this.settle(() => {
      const ordered = [...input.context.findings].sort(byPriority);
      const order = ordered.map((f) => f.ruleId);
      const failing = ordered.filter((f) => f.status === "fail");
      const reasons = failing.slice(0, 3).map((f) => {
        const rule = this.rulesById.get(f.ruleId);
        const points = f.points > 0 ? ` It is worth ${f.points} points.` : "";
        return {
          ruleId: f.ruleId,
          reason: clip(rule === undefined ? `Fix this early.${points}` : `${rule.failTitle}. ${firstSentence(rule.explanation)}${points}`),
        };
      });
      return { order, reasons, startWith: failing.slice(0, 3).map((f) => f.ruleId) };
    });
  }

  ask(input: AskInput): Promise<ExplainerResult<Answer>> {
    return this.settle(() => {
      const top = [...input.context.findings].filter((f) => f.status === "fail").sort(byPriority).slice(0, 3);
      if (top.length === 0) {
        return {
          answer: "Every check that could run passed, so there is nothing to fix first. Rescan now and then to keep it that way.",
          relatedRuleIds: [],
          outsideScope: false,
        };
      }
      const names = top.map((f) => this.rulesById.get(f.ruleId)?.failTitle.toLowerCase() ?? f.ruleId);
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      return {
        answer: clip(
          `Start with these: ${list}. They cost the most points and, because ${situation(input.context)}, they matter most. Open each item in the app and follow the fix shown there.`,
        ),
        relatedRuleIds: top.map((f) => f.ruleId),
        outsideScope: false,
      };
    });
  }
}

export function createDemoAdapters(options: DemoOptions): Adapters {
  const state = DEMO_FIXTURES[options.fixture];
  const delay = options.collectDelayMs ?? DEFAULT_COLLECT_DELAY_MS;
  const failure = options.explainerFailure ?? null;
  return {
    systemState: new DemoSystemState(state, delay),
    license: new DemoLicense(),
    secrets: new DemoSecretStore(),
    reports: new DemoReportStore(),
    openSettingsPane: demoOpenSettingsPane,
    openAssistant: demoOpenAssistant,
    async createExplainer(settings: ExplainerSettings): Promise<ExplainerPort> {
      switch (settings.provider) {
        case "browser":
        case "none":
          return new NoExplainer();
        case "claude":
        case "ollama":
          return new DemoExplainer(settings.provider, MACOS_CATALOG, failure, DEMO_EXPLAIN_DELAY_MS);
      }
    },
  };
}
