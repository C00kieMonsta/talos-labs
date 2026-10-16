import type { AiAvailability, AutomationStatus, ExplainerFailure } from "@talos/core";
import type { Adapters } from "../adapters";
import { createDemoAdapters, DEMO_FIX_OUTCOMES, DEMO_FIXTURE_NAMES, DEMO_LICENSE_KEY } from "../adapters/demo";
import type { DemoFixture, DemoOptions } from "../adapters/demo";
import { loadSettings, PROVIDERS, saveSettings } from "../settings";
import type { AppSettings, ExplainerProvider } from "../settings";

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
  /** Scale for the Scanning reveal schedule; 0 collapses it, null leaves it alone. */
  readonly pace: number | null;
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
  const pollAfter = count(params, "poll_after");
  const pace = count(params, "pace");
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
      ...(fixDelay !== null ? { fixDelayMs: fixDelay } : {}),
      ...(ai !== null ? { ai } : {}),
      ...(aiReady !== null ? { aiReadyMs: aiReady } : {}),
      ...(fdaAfter !== null ? { fdaAfter } : {}),
      ...(automation !== null ? { automation } : {}),
      ...(pollAfter !== null ? { pollAfter } : {}),
      ...(fail.length > 0 ? { fail } : {}),
    },
    reset: flag(params, "reset"),
    licensed: flag(params, "licensed"),
    provider,
    developerMode: flag(params, "dev") || (provider !== null && provider !== "apple"),
    onboarded: flag(params, "onboarded"),
    pace,
  };
}

/** The settings to store before boot, or null when the URL asks for no change. */
export function seedSettings(current: AppSettings, flags: DemoFlags): AppSettings | null {
  if (flags.provider === null && !flags.developerMode && !flags.onboarded) return null;
  return {
    ...current,
    explainer: flags.provider === null ? current.explainer : { ...current.explainer, provider: flags.provider },
    developer: { ...current.developer, enabled: current.developer.enabled || flags.developerMode },
    onboarded: current.onboarded || flags.onboarded,
  };
}

/** Applies the URL flags to storage and returns fixture-backed adapters. */
export function bootDemo(search: string, storage: Storage | null): Adapters {
  const flags = parseDemoQuery(search);
  if (flags.reset) storage?.clear();
  const seeded = seedSettings(loadSettings(), flags);
  if (seeded !== null) saveSettings(seeded);
  if (flags.pace !== null && typeof window !== "undefined") window.__talosDemoPace = flags.pace;
  const adapters = createDemoAdapters(flags.options);
  if (flags.licensed) void adapters.license.install(DEMO_LICENSE_KEY);
  return adapters;
}
