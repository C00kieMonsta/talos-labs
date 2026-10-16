import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CircleAlert, CircleCheck, Cpu, Download, LoaderCircle, Sparkles } from "lucide-react";
import { CORE_VERSION } from "@talos/core";
import type { AiAvailability, Capabilities, ExplainerProfile, LicenseState } from "@talos/core";
import { LicenceField } from "../components/LicenceField";
import { ProfileForm } from "../components/ProfileForm";
import { useApp } from "../app/context";
import { AI_AVAILABILITY_LABELS, CHECKUP_SETTINGS, LICENSE_INVALID_LABELS, PERMISSION_STATUS_LABELS, PRIVACY_SENTENCE, summariseProfile } from "../app/labels";
import { CopyButton } from "../components/CopyButton";
import { GUIDED_STORAGE_KEY, loadGuidedMemory } from "../guided/memory";
import type { GuidedController } from "../guided/state";
import type { PermissionStatus } from "../app/labels";
import { APP_VERSION } from "../app/version";
import { MAX_MODEL_ID_LENGTH } from "../settings";
import type { DeveloperSettings, ExplainerProvider } from "../settings";

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
}

export const AI_SENTENCE = "Runs on this Mac. Only the check-up results are used, never file names, paths or passwords.";
export const FREE_LINE = "Free: the three most valuable fixes";
export const PERMISSION_TITLES: Readonly<Record<PermissionKind, string>> = {
  full_disk_access: "Full Disk Access",
  automation: "Automation",
};

const CLAUDE_MODEL = /^claude-[a-z0-9-]+$/;
const OLLAMA_MODEL = /^[a-z0-9._:-]+$/;
const PROVIDER_LABELS: Readonly<Record<ExplainerProvider, string>> = {
  apple: "On this Mac",
  claude: "Claude API key",
  ollama: "Local Ollama",
};

function modelIdOk(id: string, pattern: RegExp): boolean {
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

function AiIcon({ state }: { state: AiAvailability }) {
  const props = { size: 16, "aria-hidden": true } as const;
  switch (state) {
    case "available":
      return <CircleCheck {...props} />;
    case "model_not_ready":
      return <Download {...props} />;
    case "apple_intelligence_not_enabled":
      return <Sparkles {...props} />;
    case "device_not_eligible":
      return <Cpu {...props} />;
    default:
      return <CircleAlert {...props} />;
  }
}

/** A section title over a bordered group; each direct child of the group is one 64 px row. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="section-title">
        {title}
      </h2>
      <div className="settings-group">{children}</div>
    </section>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(next: boolean): void }) {
  return (
    <label className="toggle setting-row">
      <span className="setting-text">
        <strong>{label}</strong>
      </span>
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function CheckUpSection() {
  const { settings, updateSettings } = useApp();
  const { guided } = settings;
  return (
    <Section id="checkup" title={CHECKUP_SETTINGS.title}>
      <Switch label={CHECKUP_SETTINGS.autoScan} checked={guided.autoScan} onChange={(autoScan) => updateSettings({ guided: { ...guided, autoScan } })} />
      <Switch label={CHECKUP_SETTINGS.home} checked={guided.home} onChange={(home) => updateSettings({ guided: { ...guided, home } })} />
      <p className="muted small">{CHECKUP_SETTINGS.sentence}</p>
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

function AiSection({ aiAvailability, onAiAction }: Pick<SettingsProps, "aiAvailability" | "onAiAction">) {
  const { settings, updateSettings } = useApp();
  const enabled = settings.explainer.aiEnabled;
  const state = aiAvailability;
  const label = state === null ? null : AI_AVAILABILITY_LABELS[state];
  return (
    <Section id="ai" title="AI explanations">
      <Switch
        label="Explain findings with Apple Intelligence"
        checked={enabled}
        onChange={(aiEnabled) => updateSettings({ explainer: { ...settings.explainer, aiEnabled } })}
      />
      {enabled && (
        <p className="status" data-state={state ?? "checking"}>
          {state === null ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <AiIcon state={state} />}{" "}
          <span>{label === null ? "Checking" : label.word}</span>
          {state !== null && label !== null && label.action !== null && (
            <button type="button" className="toolbar-button" onClick={() => onAiAction(state)}>
              {label.action}
            </button>
          )}
        </p>
      )}
      <p className="muted small">{AI_SENTENCE}</p>
    </Section>
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
                <span className={status === "granted" ? "pill pill-accent" : "pill"} data-status={status ?? "checking"}>
                  {status === null ? "Checking" : PERMISSION_STATUS_LABELS[status]}
                </span>
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
      <p>{license.status === "invalid" ? `The stored key is not valid: ${LICENSE_INVALID_LABELS[license.reason]}` : FREE_LINE}</p>
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

function ModelIdField({ id, label, value, pattern, hint, onChange }: { id: string; label: string; value: string; pattern: RegExp; hint: string; onChange(next: string): void }) {
  const ok = modelIdOk(value, pattern);
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        maxLength={MAX_MODEL_ID_LENGTH}
        aria-invalid={!ok}
        aria-describedby={ok ? undefined : `${id}-error`}
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

function DeveloperSection({ guided }: Pick<SettingsProps, "guided">) {
  const { settings, updateSettings } = useApp();
  const { developer, explainer } = settings;
  const setDeveloper = (patch: Partial<DeveloperSettings>) => updateSettings({ developer: { ...developer, ...patch } });
  const setEnabled = (enabled: boolean) => {
    // Leaving Developer mode hides the other providers, so go back to the on-device one.
    const next = !enabled && explainer.provider !== "apple" ? { ...explainer, provider: "apple" as const } : explainer;
    updateSettings({ developer: { ...developer, enabled }, explainer: next });
  };
  const setProvider = (provider: ExplainerProvider) => updateSettings({ explainer: { ...explainer, provider } });
  const providers: readonly ExplainerProvider[] = ["apple", "claude", "ollama"];
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
                {PROVIDER_LABELS[provider]}
              </label>
            ))}
          </fieldset>
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
          <AboutYouSection />
          {guided !== undefined && <GuidedDevBlock {...guided} />}
        </div>
      )}
    </Section>
  );
}

function AboutSection() {
  const { catalog, license } = useApp();
  const rows: readonly [string, ReactNode][] = [
    ["Version", APP_VERSION],
    ["Core", CORE_VERSION],
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
      <p className="muted small">{PRIVACY_SENTENCE}</p>
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

export function Settings({ aiAvailability, onAiAction, capabilities, onPermission, onBuy, guided }: SettingsProps) {
  return (
    <div className="screen settings">
      <CheckUpSection />
      <AiSection aiAvailability={aiAvailability} onAiAction={onAiAction} />
      <PermissionsSection capabilities={capabilities} onPermission={onPermission} />
      <LicenceSection onBuy={onBuy} />
      <DeveloperSection guided={guided} />
      <AboutSection />
    </div>
  );
}
