import type {
  ExplainerPort,
  LicensePort,
  ReportStorePort,
  SecretStorePort,
  SettingsPane,
  SystemStatePort,
} from "@talos/core";
import type { ExplainerSettings } from "../settings";
import { LICENSE_PUBLIC_KEY_HEX } from "../license/public-key";
import { REVOKED } from "../license/revoked";
import { createVerifier } from "../license/verifier";
import { ClaudeExplainerAdapter } from "./claude-explainer";
import type { ReportSource } from "./explainer-shared";
import { FileReportStore } from "./file-report-store";
import { KeychainSecretStore } from "./keychain-secret-store";
import { LicenseAdapter } from "./license";
import { NoApiKeyExplainer, NoExplainer } from "./no-explainer";
import { OllamaExplainerAdapter } from "./ollama-explainer";
import { openSettingsPane } from "./settings-pane";
import { TauriSystemStateAdapter } from "./tauri-system-state";

export { ClaudeExplainerAdapter, CLAUDE_MODEL_PATTERN, DEFAULT_CLAUDE_MODEL } from "./claude-explainer";
export { OllamaExplainerAdapter, OLLAMA_MODEL_PATTERN, DEFAULT_OLLAMA_MODEL } from "./ollama-explainer";
export { NoApiKeyExplainer, NoExplainer } from "./no-explainer";
export { FileReportStore } from "./file-report-store";
export { KeychainSecretStore } from "./keychain-secret-store";
export { LicenseAdapter } from "./license";
export { openSettingsPane } from "./settings-pane";
export { ScanError, TauriSystemStateAdapter, type ScanErrorKind } from "./tauri-system-state";
export type { ReportSource } from "./explainer-shared";

export interface Adapters {
  systemState: SystemStatePort;
  license: LicensePort;
  secrets: SecretStorePort;
  reports: ReportStorePort;
  openSettingsPane(pane: SettingsPane): Promise<void>;
  createExplainer(settings: ExplainerSettings): Promise<ExplainerPort>;
}

export interface ExplainerDeps {
  readonly secrets: SecretStorePort;
  readonly reportSource: ReportSource;
}

export async function createExplainer(settings: ExplainerSettings, deps: ExplainerDeps): Promise<ExplainerPort> {
  switch (settings.provider) {
    case "none":
      return new NoExplainer();
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
  const reports = new FileReportStore();
  const reportSource: ReportSource = () => reports.current();
  return {
    systemState: new TauriSystemStateAdapter(),
    license: new LicenseAdapter(createVerifier(LICENSE_PUBLIC_KEY_HEX), __BUILD_DATE__, REVOKED),
    secrets,
    reports,
    openSettingsPane,
    createExplainer: (settings) => createExplainer(settings, { secrets, reportSource }),
  };
}
