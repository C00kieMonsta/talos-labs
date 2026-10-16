import type { AiAvailability, AutomationStatus, ExplainerFailure, ExplainerProfile, RuleId, ScanReport } from "@talos/core";
import { evaluate, MACOS_CATALOG } from "@talos/core";
import type { Adapters } from "../adapters";
import { createDemoAdapters, DEMO_BATCH_OUTCOMES, DEMO_FIX_OUTCOMES, DEMO_FIXTURE_NAMES, DEMO_FIXTURES, DEMO_LICENSE_KEY, DEMO_SCAN_ERRORS, withForcedFailures } from "../adapters/demo";
import type { DemoFixture, DemoOptions } from "../adapters/demo";
import { loadSettings, PROVIDERS, saveSettings } from "../settings";
import type { AppSettings, ExplainerProvider } from "../settings";

/** Mirrors guided/continue.ts and guided/memory.ts; the keys are fixed by DESIGN-V03.md section 7. */
export const DEMO_CONTINUE_KEY = "talos.continue";
export const DEMO_GUIDED_MEMORY_KEY = "talos.guided";
const TECHNICAL: readonly ExplainerProfile["technical"][] = ["low", "medium", "high"];

/** Demo mode reads its options from the page URL. See apps/desktop/qa/README.md. */

const EXPLAINER_FAILURES: readonly ExplainerFailure[] = [
  "not_configured",
  "no_api_key",
  "network",
  "auth",
  "timeout",
  "rejected_output",
  "refused",
  "unknown",
  "unavailable",
  "too_long",
  "cancelled",
  "busy",
];

const AI_STATES: readonly AiAvailability[] = [
  "available",
  "device_not_eligible",
  "apple_intelligence_not_enabled",
  "model_not_ready",
  "helper_unavailable",
];

const AUTOMATION: readonly AutomationStatus[] = ["granted", "denied", "not_determined"];

export interface DemoFlags {
  readonly options: DemoOptions;
  /** Clear localStorage before boot. */
  readonly reset: boolean;
  /** Pre-install the demo licence. */
  readonly licensed: boolean;
  readonly provider: ExplainerProvider | null;
  readonly developerMode: boolean;
  readonly onboarded: boolean;
  /** Scale for the Scanning reveal schedule and the guided timers; 0 collapses them, null leaves them alone. */
  readonly pace: number | null;
  /** guided=0 opens the expert home. */
  readonly guided: boolean;
  /** JSON for talos.guided, stored as given; the app parses it field by field. */
  readonly memory: string | null;
  /** since=1 seeds a previous report with two fixed and one new finding. */
  readonly since: boolean;
  /** continue=guided seeds talos.continue. */
  readonly continueGuided: boolean;
  readonly technical: ExplainerProfile["technical"] | null;
}

function pickOne<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function flag(params: URLSearchParams, name: string): boolean {
  return params.get(name) === "1";
}

/** A non-negative integer, or null. */
function count(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function parseDemoQuery(search: string): DemoFlags {
  const params = new URLSearchParams(search);
  const fixture: DemoFixture = pickOne(params.get("fixture"), DEMO_FIXTURE_NAMES) ?? "dev-machine";
  const explainerFailure = pickOne(params.get("explainer"), EXPLAINER_FAILURES);
  const delay = count(params, "delay");
  const provider = pickOne(params.get("provider"), PROVIDERS);
  const fix = pickOne(params.get("fix"), DEMO_FIX_OUTCOMES);
  const fixDelay = count(params, "fix_delay");
  const ai = pickOne(params.get("ai"), AI_STATES);
  const aiReady = count(params, "ai_ready");
  const fdaAfter = count(params, "fda_after");
  const automation = pickOne(params.get("automation"), AUTOMATION);
  const bundled = params.get("bundled") !== "0";
  const pollAfter = count(params, "poll_after") ?? count(params, "watch_after");
  const pace = count(params, "pace");
  const batch = pickOne(params.get("batch"), DEMO_BATCH_OUTCOMES);
  const scanError = pickOne(params.get("scan_error"), DEMO_SCAN_ERRORS);
  const technical = pickOne(params.get("technical"), TECHNICAL);
  const fail = (params.get("fail") ?? "")
    .split(",")
    .filter((id) => id === "013" || id === "TL-MAC-013")
    .map(() => "TL-MAC-013" as const);
  return {
    options: {
      fixture,
      explainerFailure,
      ...(delay !== null ? { collectDelayMs: delay } : {}),
      ...(fix !== null ? { fix } : {}),
      ...(batch !== null ? { batch } : {}),
      ...(scanError !== null ? { scanError } : {}),
      ...(fixDelay !== null ? { fixDelayMs: fixDelay } : {}),
      ...(ai !== null ? { ai } : {}),
      ...(aiReady !== null ? { aiReadyMs: aiReady } : {}),
      ...(fdaAfter !== null ? { fdaAfter } : {}),
      ...(automation !== null ? { automation } : {}),
      ...(bundled ? {} : { bundled }),
      ...(pollAfter !== null ? { pollAfter } : {}),
      ...(fail.length > 0 ? { fail } : {}),
    },
    reset: flag(params, "reset"),
    licensed: flag(params, "licensed"),
    provider,
    developerMode: flag(params, "dev") || (provider !== null && provider !== "apple"),
    onboarded: flag(params, "onboarded"),
    pace,
    guided: params.get("guided") !== "0",
    memory: params.get("memory"),
    since: flag(params, "since"),
    continueGuided: params.get("continue") === "guided",
    technical,
  };
}

/** The fixture's report with two passing rules failing and one failing rule passing, so the diff shows 2 fixed and 1 appeared. */
export function previousReportFor(fixture: DemoFixture, fail: readonly RuleId[] = []): ScanReport {
  const state = withForcedFailures(DEMO_FIXTURES[fixture], fail);
  const report = evaluate(state, MACOS_CATALOG, { now: new Date(Date.now() - 86_400_000).toISOString(), os: state.host.os });
  const fixed = report.results.filter((r) => r.status === "pass").slice(0, 2).map((r) => r.ruleId);
  const appeared = report.results.filter((r) => r.status === "fail").slice(0, 1).map((r) => r.ruleId);
  const results = report.results.map((r) => (fixed.includes(r.ruleId) ? { ...r, status: "fail" as const } : appeared.includes(r.ruleId) ? { ...r, status: "pass" as const } : r));
  return { ...report, reportId: "demo-previous", results };
}

/** The settings to store before boot, or null when the URL asks for no change. */
export function seedSettings(current: AppSettings, flags: DemoFlags): AppSettings | null {
  if (flags.provider === null && !flags.developerMode && !flags.onboarded && flags.guided && flags.technical === null) return null;
  return {
    ...current,
    explainer: flags.provider === null ? current.explainer : { ...current.explainer, provider: flags.provider },
    profile: flags.technical === null ? current.profile : { ...current.profile, technical: flags.technical },
    developer: { ...current.developer, enabled: current.developer.enabled || flags.developerMode },
    onboarded: current.onboarded || flags.onboarded,
    guided: flags.guided ? current.guided : { ...current.guided, home: false },
  };
}

/** Applies the URL flags to storage and returns fixture-backed adapters. */
export function bootDemo(search: string, storage: Storage | null): Adapters {
  const flags = parseDemoQuery(search);
  if (flags.reset) storage?.clear();
  const seeded = seedSettings(loadSettings(), flags);
  if (seeded !== null) saveSettings(seeded);
  if (flags.pace !== null && typeof window !== "undefined") window.__talosDemoPace = flags.pace;
  if (flags.memory !== null) storage?.setItem(DEMO_GUIDED_MEMORY_KEY, flags.memory);
  if (flags.continueGuided) storage?.setItem(DEMO_CONTINUE_KEY, JSON.stringify({ kind: "guided" }));
  const previousReport = flags.since ? previousReportFor(flags.options.fixture, flags.options.fail ?? []) : null;
  const adapters = createDemoAdapters({ ...flags.options, previousReport });
  if (flags.licensed) void adapters.license.install(DEMO_LICENSE_KEY);
  return adapters;
}
