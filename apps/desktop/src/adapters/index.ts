import type {
  ExplainerPort,
  FixPort,
  LicensePort,
  ReportStorePort,
  SecretStorePort,
  SettingsPane,
  SystemStatePort,
} from "@talos/core";
import { MACOS_CATALOG } from "@talos/core";
import type { ExplainerSettings } from "../settings";
import { LICENSE_PUBLIC_KEY_HEX } from "../license/public-key";
import { REVOKED } from "../license/revoked";
import { createVerifierOrRejectAll } from "../license/verifier";
import { AppleExplainerAdapter } from "./apple-explainer";
import { ClaudeExplainerAdapter } from "./claude-explainer";
import type { ReportSource } from "./explainer-shared";
import { FileReportStore } from "./file-report-store";
import { KeychainSecretStore } from "./keychain-secret-store";
import { LicenseAdapter } from "./license";
import { NoApiKeyExplainer, NoExplainer } from "./no-explainer";
import { OllamaExplainerAdapter } from "./ollama-explainer";
import { openSettingsPane } from "./settings-pane";
import { appRestart, TauriFixAdapter } from "./tauri-fix";
import { TauriSystemStateAdapter } from "./tauri-system-state";

export { AppleExplainerAdapter } from "./apple-explainer";
export { ClaudeExplainerAdapter, CLAUDE_MODEL_PATTERN, DEFAULT_CLAUDE_MODEL } from "./claude-explainer";
export { OllamaExplainerAdapter, OLLAMA_MODEL_PATTERN, DEFAULT_OLLAMA_MODEL } from "./ollama-explainer";
export { NoApiKeyExplainer, NoExplainer } from "./no-explainer";
export { FileReportStore } from "./file-report-store";
export { KeychainSecretStore } from "./keychain-secret-store";
export { LicenseAdapter } from "./license";
export { openSettingsPane } from "./settings-pane";
export { TauriFixAdapter, appRestart } from "./tauri-fix";
export { ScanError, TauriSystemStateAdapter, type ScanErrorKind } from "./tauri-system-state";
export type { ReportSource } from "./explainer-shared";

export interface Adapters {
  systemState: SystemStatePort;
  license: LicensePort;
  secrets: SecretStorePort;
  reports: ReportStorePort;
  /** The only port that can change the Mac. */
  fixes: FixPort;
  openSettingsPane(pane: SettingsPane): Promise<void>;
  /** Relaunches the app, for the Full Disk Access continuation. */
  restart(): Promise<void>;
  createExplainer(settings: ExplainerSettings): Promise<ExplainerPort>;
}

export interface ExplainerDeps {
  readonly secrets: SecretStorePort;
  readonly reportSource: ReportSource;
}

export async function createExplainer(settings: ExplainerSettings, deps: ExplainerDeps): Promise<ExplainerPort> {
  if (!settings.aiEnabled) return new NoExplainer();
  switch (settings.provider) {
    case "apple":
      return AppleExplainerAdapter.shared(deps.reportSource);
    case "claude": {
      const key = await deps.secrets.get("anthropic_api_key");
      if (key === null || key.length === 0) return new NoApiKeyExplainer();
      return new ClaudeExplainerAdapter({
        secrets: deps.secrets,
        reportSource: deps.reportSource,
        model: settings.claudeModel,
      });
    }
    case "ollama":
      return new OllamaExplainerAdapter({ reportSource: deps.reportSource, model: settings.ollamaModel });
  }
}

export function createAdapters(): Adapters {
  const secrets = new KeychainSecretStore();
  const reports = new FileReportStore(MACOS_CATALOG);
  const reportSource: ReportSource = () => reports.current();
  return {
    systemState: new TauriSystemStateAdapter(),
    // A placeholder or otherwise unusable key rejects every licence rather than accepting forged ones.
    license: new LicenseAdapter(createVerifierOrRejectAll(LICENSE_PUBLIC_KEY_HEX), __BUILD_DATE__, REVOKED),
    secrets,
    reports,
    fixes: new TauriFixAdapter(),
    openSettingsPane,
    restart: appRestart,
    createExplainer: (settings) => createExplainer(settings, { secrets, reportSource }),
  };
}
