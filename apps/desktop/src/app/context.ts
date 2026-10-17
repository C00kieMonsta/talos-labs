import { createContext, useContext } from "react";
import type { Capabilities, GuidedMemory, LicenseState, RuleCatalog, RuleId } from "@talos/core";
import type { Adapters } from "../adapters";
import type { AppSettings } from "../settings";
import type { ScanController } from "../scan/useScan";
import type { Router } from "./router";
import type { AiController } from "../scan/useAiAvailability";
import type { Gate } from "./gate";

export interface AppContextValue {
  readonly adapters: Adapters;
  readonly catalog: RuleCatalog;
  readonly settings: AppSettings;
  updateSettings(patch: Partial<AppSettings>): void;
  readonly license: LicenseState;
  setLicense(state: LicenseState): void;
  readonly gate: Gate;
  readonly scan: ScanController;
  readonly router: Router;
  /** True when Ask can answer: the on-device model is available, or Developer mode has a Claude or Ollama provider. */
  readonly aiUsable: boolean;
  /** The lazy on-device availability probe and its re-probe schedules. */
  readonly ai: AiController;
  /** The last check_capabilities answer; null until asked. */
  readonly capabilities: Capabilities | null;
  refreshCapabilities(): Promise<Capabilities | null>;
  /** The guided memory App holds; screens read it through acceptedFailing (DESIGN-ACCEPT.md section 3, item 10). */
  readonly guidedMemory: GuidedMemory;
  /** "Leave it alone, I know the risk" on the Finding detail. */
  acceptRule(ruleId: RuleId): void;
  /** "Ask me again" on the Finding detail: the one undo. */
  unacceptRule(ruleId: RuleId): void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) throw new Error("useApp must be used inside AppContext.Provider");
  return value;
}
