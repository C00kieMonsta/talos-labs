import type { ExplainerFailure } from "@talos/core";
import type { Adapters } from "../adapters";
import { createDemoAdapters, DEMO_FIXTURE_NAMES, DEMO_LICENSE_KEY } from "../adapters/demo";
import type { DemoFixture, DemoOptions } from "../adapters/demo";
import { isInAppProvider, loadSettings, PROVIDERS, saveSettings } from "../settings";
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
];

export interface DemoFlags {
  readonly options: DemoOptions;
  /** Clear localStorage before boot. */
  readonly reset: boolean;
  /** Pre-install the demo licence. */
  readonly licensed: boolean;
  readonly provider: ExplainerProvider | null;
  readonly developerMode: boolean;
  readonly onboarded: boolean;
}

function pickOne<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function flag(params: URLSearchParams, name: string): boolean {
  return params.get(name) === "1";
}

export function parseDemoQuery(search: string): DemoFlags {
  const params = new URLSearchParams(search);
  const fixture: DemoFixture = pickOne(params.get("fixture"), DEMO_FIXTURE_NAMES) ?? "dev-machine";
  const explainerFailure = pickOne(params.get("explainer"), EXPLAINER_FAILURES);
  const delayRaw = params.get("delay");
  const delay = delayRaw === null ? Number.NaN : Number(delayRaw);
  const provider = pickOne(params.get("provider"), PROVIDERS);
  return {
    options: {
      fixture,
      explainerFailure,
      ...(Number.isInteger(delay) && delay >= 0 ? { collectDelayMs: delay } : {}),
    },
    reset: flag(params, "reset"),
    licensed: flag(params, "licensed"),
    provider,
    developerMode: flag(params, "dev") || (provider !== null && isInAppProvider(provider)),
    onboarded: flag(params, "onboarded"),
  };
}

/** The settings to store before boot, or null when the URL asks for no change. */
export function seedSettings(current: AppSettings, flags: DemoFlags): AppSettings | null {
  if (flags.provider === null && !flags.developerMode && !flags.onboarded) return null;
  return {
    ...current,
    explainer: flags.provider === null ? current.explainer : { ...current.explainer, provider: flags.provider },
    developerMode: current.developerMode || flags.developerMode,
    onboarded: current.onboarded || flags.onboarded,
  };
}

/** Applies the URL flags to storage and returns fixture-backed adapters. */
export function bootDemo(search: string, storage: Storage | null): Adapters {
  const flags = parseDemoQuery(search);
  if (flags.reset) storage?.clear();
  const seeded = seedSettings(loadSettings(), flags);
  if (seeded !== null) saveSettings(seeded);
  const adapters = createDemoAdapters(flags.options);
  if (flags.licensed) void adapters.license.install(DEMO_LICENSE_KEY);
  return adapters;
}
