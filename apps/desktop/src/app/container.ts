import type { ExplainerContext, ExplainerProfile, ScanReport, SystemState } from "@talos/core";
import { evaluate, MACOS_CATALOG, toExplainerContext } from "@talos/core";
import { createAdapters } from "../adapters";
import type { Adapters } from "../adapters";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../settings";
import { bootDemo } from "./demo-boot";

export const APP_VERSION = "0.1.0";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// Demo mode is a build-time choice. VITE_TALOS_DEMO is inlined by Vite; no runtime flag can turn it on.
export const adapters: Adapters =
  import.meta.env.VITE_TALOS_DEMO === "1" ? bootDemo(window.location.search, storage()) : createAdapters();

export const catalog = MACOS_CATALOG;

export function runEngine(state: SystemState): ScanReport {
  return evaluate(state, MACOS_CATALOG, { now: new Date().toISOString(), os: state.host.os });
}

export function buildContext(report: ScanReport, profile: ExplainerProfile): ExplainerContext {
  return toExplainerContext(report, MACOS_CATALOG, profile);
}

export { DEFAULT_SETTINGS, loadSettings, saveSettings };
