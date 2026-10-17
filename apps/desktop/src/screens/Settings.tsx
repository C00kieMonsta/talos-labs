import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CHATGPT_MODEL_PATTERN, CORE_VERSION } from "@talos/core";
import type { AiAvailability, Capabilities, ExplainerProfile, LicenseState } from "@talos/core";
import { LicenceField } from "../components/LicenceField";
import { ProfileForm } from "../components/ProfileForm";
import { useApp } from "../app/context";
import { CHECKUP_SETTINGS, LICENSE_INVALID_LABELS, PERMISSION_STATUS_LABELS, PROVIDER_NAMES, YOUR_AI, privacySentence, summariseProfile } from "../app/labels";
import { CopyButton } from "../components/CopyButton";
import { GUIDED_STORAGE_KEY, loadGuidedMemory } from "../guided/memory";
import type { GuidedController } from "../guided/state";
import type { PermissionStatus } from "../app/labels";
import { APP_VERSION } from "../app/version";
import { MAX_MODEL_ID_LENGTH, PROVIDERS, isDeveloperProvider } from "../settings";
import type { DeveloperSettings, ExplainerProvider } from "../settings";
import { WatchSection } from "./WatchSection";
import { Section, Switch, YourAiSection } from "./YourAiSection";

export type PermissionKind = "full_disk_access" | "automation";

export interface SettingsProps {
  /** null until the first probe has answered. */
  aiAvailability: AiAvailability | null;
  /** The one button of the current AI state (Open Apple Intelligence settings, Try again). */
  onAiAction(state: AiAvailability): void;
  /** null until check_capabilities has answered. */
  capabilities: Capabilities | null;
  /** Open or Allow on a permission row; starts the flow in section 6 of the design. */
  onPermission(kind: PermissionKind, status: PermissionStatus): void;
  onBuy(): void;
  /** The guided controller and its memory, for the Developer "Guided" block. */
  guided?: { controller: GuidedController; onResetMemory(): void; onSkipCooldown(): void };
  /** Change on the Your AI row: opens the Connect screen. */
  onChangeAi?(): void;
  /** False when the Connect screen would offer no row at all; Change is then hidden. */
  canChangeAi?: boolean;
  /** Disconnect on the Your AI row: clears the stored sign-in on this Mac. False when it could not be cleared. */
  onDisconnect?(): Promise<boolean>;
  /** The read-only Developer lines; null until fetched, and always null in demo mode. */
  providerInfo?: ProviderInfo;
}

/** What claude_code_info answers; the identity is a constant on the Rust side, never parsed output. */
export interface ClaudeCodeInfo {
  offered: boolean;
  version: string | null;
  path: string | null;
  signed: boolean;
  identity: string | null;
  source: "existing" | "fetched" | "none";
}

export interface ProviderInfo {
  claudeCode: ClaudeCodeInfo | null;
  chatgptClientId: string | null;
}

const NO_PROVIDER_INFO: ProviderInfo = { claudeCode: null, chatgptClientId: null };
const noop = (): void => undefined;
const resolved = async (): Promise<boolean> => true;

/** "Claude Code: 2.1.287, Developer ID Application: Anthropic PBC (Q6L2SF6YDW), /path" or "Claude Code: not fetched". */
export function claudeCodeLine(info: ClaudeCodeInfo | null): string {
  if (info === null || info.version === null) return `${YOUR_AI.claudeCodeLine}: ${YOUR_AI.notFetched}`;
  const parts = [info.version, info.signed && info.identity !== null ? info.identity : "unsigned", info.path].filter((p): p is string => p !== null);
  return `${YOUR_AI.claudeCodeLine}: ${parts.join(", ")}`;
}

export function chatgptClientLine(clientId: string | null): string {
  return `${YOUR_AI.chatgptClientLine}: ${clientId ?? YOUR_AI.none}`;
}

export const FREE_LINE = "Free: the three most valuable fixes";
export const PERMISSION_TITLES: Readonly<Record<PermissionKind, string>> = {
  full_disk_access: "Full Disk Access",
  automation: "Automation",
};
/** Under the Full Disk Access row when the binary runs outside an app bundle (pnpm tauri dev). */
export const DEV_BUILD_FDA_COPY = "This is a development build, so it is not in the list. Press the + button and add the app that launched it (your terminal or editor), or build the app bundle.";

const CLAUDE_MODEL = /^claude-[a-z0-9-]+$/;
const OLLAMA_MODEL = /^[a-z0-9._:-]+$/;
function modelIdOk(id: string, pattern: RegExp, allowEmpty: boolean): boolean {
  if (id.length === 0) return allowEmpty;
  return pattern.test(id) && id.length <= MAX_MODEL_ID_LENGTH;
}

/** The pill word for each row, from the probe. */
export function permissionStatus(capabilities: Capabilities, kind: PermissionKind): PermissionStatus {
  if (kind === "full_disk_access") {
    if (capabilities.fullDiskAccess === null) return "unknown";
    return capabilities.fullDiskAccess ? "granted" : "not_granted";
  }
  switch (capabilities.automation) {
    case "granted":
      return "granted";
    case "denied":
      return "not_granted";
    case "not_determined":
      return "not_determined";
    default:
      return "unknown";
  }
}

/** The button label for a row, or null when there is nothing to do. */
export function permissionAction(kind: PermissionKind, status: PermissionStatus): string | null {
  if (status === "granted") return null;
  if (status === "not_determined") return "Allow";
  return kind === "full_disk_access" ? "Open Full Disk Access" : "Open Automation settings";
}

function CheckUpSection() {
  const { settings, updateSettings } = useApp();
  const { guided } = settings;
  return (
    <Section id="checkup" title={CHECKUP_SETTINGS.title}>
      <Switch label={CHECKUP_SETTINGS.autoScan} checked={guided.autoScan} onChange={(autoScan) => updateSettings({ guided: { ...guided, autoScan } })} />
      <Switch label={CHECKUP_SETTINGS.home} description={CHECKUP_SETTINGS.sentence} checked={guided.home} onChange={(home) => updateSettings({ guided: { ...guided, home } })} />
    </Section>
  );
}

function GuidedDevBlock({ controller, onResetMemory, onSkipCooldown }: NonNullable<SettingsProps["guided"]>) {
  const { settings } = useApp();
  const { phase } = controller;
  const plan = phase.kind === "since" || phase.kind === "plan" || phase.kind === "step" || phase.kind === "end" ? phase.plan : null;
  const memory = loadGuidedMemory();
  const current = phase.kind === "step" ? phase.index : -1;
  return (
    <div className="subsection" data-testid="guided-dev">
      <h3>Guided</h3>
      <p className="muted small">Phase: {phase.kind}</p>
      {plan === null ? (
        <p className="muted small">No plan yet.</p>
      ) : (
        <ol className="plain-list mono small">
          {plan.steps.map((step, index) => {
            const snooze = "ruleId" in step ? memory.snoozed[step.ruleId] : undefined;
            return (
              <li key={step.id}>
                {step.id} · {step.kind} · {index < current ? "passed" : index === current ? (phase.kind === "step" ? phase.state.kind : "current") : "pending"}
                {snooze !== undefined && ` · snoozed until ${snooze}`}
              </li>
            );
          })}
        </ol>
      )}
      <pre className="mono small">{JSON.stringify(memory, null, 2)}</pre>
      <div className="actions">
        <button type="button" className="button button-small" onClick={onResetMemory}>
          Reset
        </button>
        <button type="button" className="button button-small" onClick={() => controller.start()}>
          Run the check-up now
        </button>
        <button type="button" className="button button-small" onClick={onSkipCooldown}>
          Skip the cooldown
        </button>
        {plan !== null && <CopyButton text={JSON.stringify(plan, null, 2)} subject="plan JSON" />}
      </div>
      <p className="muted small">
        Stored under {GUIDED_STORAGE_KEY}. Profile: {summariseProfile(settings.profile)}
      </p>
    </div>
  );
}

function AboutYouSection() {
  const { settings, updateSettings } = useApp();
  const [editing, setEditing] = useState(false);
  const profile: ExplainerProfile = settings.profile;
  return (
    <Section id="profile" title="About you">
      {editing ? (
        <ProfileForm value={profile} onChange={(next) => updateSettings({ profile: next })} idPrefix="settings" />
      ) : (
        <p className="setting-row">
          <span className="setting-text">{summariseProfile(profile)}</span>
          <button type="button" className="toolbar-button" onClick={() => setEditing(true)}>
            Edit
          </button>
        </p>
      )}
    </Section>
  );
}

function PermissionsSection({ capabilities, onPermission }: Pick<SettingsProps, "capabilities" | "onPermission">) {
  const kinds: readonly PermissionKind[] = ["full_disk_access", "automation"];
  return (
    <Section id="permissions" title="Permissions">
      <ul className="setting-rows">
        {kinds.map((kind) => {
          const status = capabilities === null ? null : permissionStatus(capabilities, kind);
          const action = status === null ? null : permissionAction(kind, status);
          return (
            <li key={kind} className="setting-row">
              <span className="setting-text">
                <strong>{PERMISSION_TITLES[kind]}</strong>
                <small data-status={status ?? "checking"}>{status === null ? "Checking" : PERMISSION_STATUS_LABELS[status]}</small>
                {kind === "full_disk_access" && capabilities?.bundled === false && status !== "granted" && <small>{DEV_BUILD_FDA_COPY}</small>}
              </span>
              {status !== null && action !== null && (
                <button type="button" className="toolbar-button" onClick={() => onPermission(kind, status)}>
                  {action}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function LicenceSection({ onBuy }: Pick<SettingsProps, "onBuy">) {
  const { adapters, license, setLicense } = useApp();
  const [busy, setBusy] = useState(false);
  const licensedLine = useRef<HTMLParagraphElement>(null);
  const previous = useRef(license.status);

  // Installing or removing a licence swaps the field for the summary, or back; move focus with it.
  useEffect(() => {
    if (previous.current === license.status) return;
    previous.current = license.status;
    if (license.status === "valid") licensedLine.current?.focus();
  }, [license.status]);

  async function remove() {
    setBusy(true);
    try {
      await adapters.license.remove();
      setLicense({ status: "none" });
    } finally {
      setBusy(false);
    }
  }

  if (license.status === "valid") {
    const { plan, seats, updatesUntil } = license.payload;
    return (
      <Section id="licence" title="Licence">
        <div className="setting-row">
          <p ref={licensedLine} tabIndex={-1} className="setting-text">
            Licensed, {plan} plan, {seats} {seats === 1 ? "seat" : "seats"}, updates until {updatesUntil}
          </p>
          <button type="button" className="toolbar-button" onClick={() => void remove()} disabled={busy}>
            Remove
          </button>
        </div>
      </Section>
    );
  }
  return (
    <Section id="licence" title="Licence">
      <div className="setting-row">
        <span className="setting-text">
          <strong>{FREE_LINE}</strong>
          {license.status === "invalid" && <small>The stored key is not valid: {LICENSE_INVALID_LABELS[license.reason]}</small>}
        </span>
      </div>
      <LicenceField onBuy={onBuy} />
    </Section>
  );
}

type KeyStatus = "unknown" | "saved" | "not_set";

function KeychainKeyField() {
  const { adapters } = useApp();
  const [status, setStatus] = useState<KeyStatus>("unknown");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void adapters.secrets
      .get("anthropic_api_key")
      .then((value) => {
        if (!cancelled) setStatus(value === null ? "not_set" : "saved");
      })
      .catch(() => {
        if (!cancelled) setStatus("not_set");
      });
    return () => {
      cancelled = true;
    };
  }, [adapters]);

  async function save(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (value.length === 0) return;
    try {
      await adapters.secrets.set("anthropic_api_key", value);
      setDraft("");
      setStatus("saved");
      setError(null);
    } catch {
      setError("The key could not be saved to the Keychain.");
    }
  }

  async function remove() {
    try {
      await adapters.secrets.delete("anthropic_api_key");
      setStatus("not_set");
      setError(null);
      // The Remove button unmounts with the status change; the key field is the next sensible place.
      input.current?.focus();
    } catch {
      setError("The key could not be removed from the Keychain.");
    }
  }

  return (
    <form onSubmit={save} className="inline-form">
      <label htmlFor="api-key">Anthropic API key</label>
      <p className="muted small">
        Stored in the macOS Keychain. Status: <strong>{status === "saved" ? "saved" : status === "not_set" ? "not set" : "checking"}</strong>
      </p>
      <div className="field-row">
        <input
          id="api-key"
          ref={input}
          type="password"
          autoComplete="off"
          value={draft}
          placeholder={status === "saved" ? "Enter a new key to replace it" : "sk-ant-..."}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="button" disabled={draft.trim().length === 0}>
          Save
        </button>
        {status === "saved" && (
          <button type="button" className="button button-ghost" onClick={() => void remove()}>
            Remove
          </button>
        )}
      </div>
      {error !== null && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ModelIdField({
  id,
  label,
  value,
  pattern,
  hint,
  description,
  allowEmpty = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  pattern: RegExp;
  hint: string;
  /** Always shown under the label, e.g. what an empty value means. */
  description?: string;
  allowEmpty?: boolean;
  onChange(next: string): void;
}) {
  const ok = modelIdOk(value, pattern, allowEmpty);
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      {description !== undefined && (
        <p className="muted small" id={`${id}-description`}>
          {description}
        </p>
      )}
      <input
        id={id}
        type="text"
        value={value}
        maxLength={MAX_MODEL_ID_LENGTH}
        aria-invalid={!ok}
        aria-describedby={[description === undefined ? null : `${id}-description`, ok ? null : `${id}-error`].filter((d) => d !== null).join(" ") || undefined}
        onChange={(event) => onChange(event.target.value.trim())}
      />
      {!ok && (
        <p className="notice" id={`${id}-error`}>
          {hint}
        </p>
      )}
    </div>
  );
}

function DeveloperSection({ guided, providerInfo }: Pick<SettingsProps, "guided"> & { providerInfo: ProviderInfo }) {
  const { settings, updateSettings } = useApp();
  const { developer, explainer } = settings;
  const setDeveloper = (patch: Partial<DeveloperSettings>) => updateSettings({ developer: { ...developer, ...patch } });
  const setEnabled = (enabled: boolean) => {
    // Leaving Developer mode hides the API-key and Ollama providers, so go back to the on-device one.
    const next = !enabled && isDeveloperProvider(explainer.provider) ? { ...explainer, provider: "apple" as const } : explainer;
    updateSettings({ developer: { ...developer, enabled }, explainer: next });
  };
  const setProvider = (provider: ExplainerProvider) => updateSettings({ explainer: { ...explainer, provider } });
  const providers: readonly ExplainerProvider[] = PROVIDERS;
  return (
    <Section id="developer" title="Developer mode">
      <Switch label="Developer mode" checked={developer.enabled} onChange={setEnabled} />
      {developer.enabled && (
        <div className="subsection">
          <Switch label="Show Terminal commands next to fixes" checked={developer.showCommands} onChange={(showCommands) => setDeveloper({ showCommands })} />
          <Switch label="Show the plan expanded in fix sheets" checked={developer.showPlanExpanded} onChange={(showPlanExpanded) => setDeveloper({ showPlanExpanded })} />
          <fieldset>
            <legend>Provider</legend>
            {providers.map((provider) => (
              <label key={provider}>
                <input type="radio" name="provider" checked={explainer.provider === provider} onChange={() => setProvider(provider)} />
                {PROVIDER_NAMES[provider]}
              </label>
            ))}
          </fieldset>
          {explainer.provider === "chatgpt" && (
            <ModelIdField
              id="chatgpt-model"
              label="Model id"
              value={explainer.chatgptModel}
              pattern={CHATGPT_MODEL_PATTERN}
              allowEmpty
              description="Empty uses your account's default"
              hint={`Model ids use lowercase letters, digits, dots and dashes, at most ${MAX_MODEL_ID_LENGTH} characters.`}
              onChange={(chatgptModel) => updateSettings({ explainer: { ...explainer, chatgptModel } })}
            />
          )}
          {explainer.provider === "claude" && (
            <>
              <KeychainKeyField />
              <ModelIdField
                id="claude-model"
                label="Model id"
                value={explainer.claudeModel}
                pattern={CLAUDE_MODEL}
                hint={`Model ids look like claude-opus-5 and are at most ${MAX_MODEL_ID_LENGTH} characters.`}
                onChange={(claudeModel) => updateSettings({ explainer: { ...explainer, claudeModel } })}
              />
            </>
          )}
          {explainer.provider === "ollama" && (
            <>
              <ModelIdField
                id="ollama-model"
                label="Model name"
                value={explainer.ollamaModel}
                pattern={OLLAMA_MODEL}
                hint={`Model names use lowercase letters, digits, dots, colons and dashes, at most ${MAX_MODEL_ID_LENGTH} characters.`}
                onChange={(ollamaModel) => updateSettings({ explainer: { ...explainer, ollamaModel } })}
              />
              <p className="muted small">Ollama must be running on this Mac at 127.0.0.1:11434.</p>
            </>
          )}
          <p className="muted small dev-ai-info">{claudeCodeLine(providerInfo.claudeCode)}</p>
          <p className="muted small dev-ai-info">{chatgptClientLine(providerInfo.chatgptClientId)}</p>
          <AboutYouSection />
          {guided !== undefined && <GuidedDevBlock {...guided} />}
        </div>
      )}
    </Section>
  );
}

function AboutSection() {
  const { catalog, license, settings } = useApp();
  const rows: readonly [string, ReactNode][] = [
    ["Version", APP_VERSION],
    ["Core", CORE_VERSION],
    ["Website", "taloslabs.si"],
    ["Catalogue", catalog.version],
    ["Benchmark", catalog.cisEdition],
    ["Build date", __BUILD_DATE__],
    ["Licence", licenceLine(license)],
  ];
  return (
    <Section id="about" title="About">
      <dl className="meta">
        {rows.map(([term, detail]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{detail}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">{privacySentence(settings.explainer.provider)}</p>
    </Section>
  );
}

function licenceLine(license: LicenseState): ReactNode {
  if (license.status === "valid") {
    return (
      <span className="mono small">
        id {license.payload.lid} · tag {license.payload.tag}
      </span>
    );
  }
  return license.status === "invalid" ? "Invalid" : "None";
}

export function Settings({ aiAvailability, onAiAction, capabilities, onPermission, onBuy, guided, onChangeAi = noop, canChangeAi = true, onDisconnect = resolved, providerInfo = NO_PROVIDER_INFO }: SettingsProps) {
  return (
    <div className="screen settings">
      <WatchSection />
      <CheckUpSection />
      <YourAiSection aiAvailability={aiAvailability} onAiAction={onAiAction} onChangeAi={onChangeAi} canChange={canChangeAi} onDisconnect={onDisconnect} />
      <PermissionsSection capabilities={capabilities} onPermission={onPermission} />
      <LicenceSection onBuy={onBuy} />
      <DeveloperSection guided={guided} providerInfo={providerInfo} />
      <AboutSection />
    </div>
  );
}
