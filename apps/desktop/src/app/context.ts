import { createContext, useContext } from "react";
import type { LicenseState, RuleCatalog } from "@talos/core";
import type { Adapters } from "../adapters";
import type { AppSettings } from "../settings";
import type { ScanController } from "../scan/useScan";
import type { Router } from "./router";
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
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (value === null) throw new Error("useApp must be used inside AppContext.Provider");
  return value;
}
