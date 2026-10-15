import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Capabilities, LicenseState } from "@talos/core";
import { ProfileForm } from "../components/ProfileForm";
import { useApp } from "../app/context";
import { LICENSE_INVALID_LABELS } from "../app/labels";
import { MAX_MODEL_ID_LENGTH, isInAppProvider } from "../settings";
import type { Assistant, ExplainerProvider } from "../settings";

type KeyStatus = "unknown" | "saved" | "not_set";

const CLAUDE_MODEL = /^claude-[a-z0-9-]+$/;
const OLLAMA_MODEL = /^[a-z0-9._:-]+$/;
/** Longest model id the inputs accept; a pasted blob is marked invalid instead of being sent with every request. */

function modelIdOk(id: string, pattern: RegExp): boolean {
  return pattern.test(id) && id.length <= MAX_MODEL_ID_LENGTH;
}

export const DEVELOPER_MODE_COPY =
  "Shows Terminal commands next to fixes and unlocks API-key and local-model options for AI help.";

export function Settings() {
  const { settings, updateSettings, adapters, license, setLicense } = useApp();
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("unknown");
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [licenseDraft, setLicenseDraft] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseResult, setLicenseResult] = useState<LicenseState | null>(null);
  const licensedLine = useRef<HTMLParagraphElement>(null);
  const licenseInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const previousLicense = useRef(license.status);

  // Installing or removing a licence swaps the form for the summary, or back; move focus with it.
  useEffect(() => {
    if (previousLicense.current === license.status) return;
    previousLicense.current = license.status;
    if (license.status === "valid") licensedLine.current?.focus();
    else licenseInput.current?.focus();
  }, [license.status]);

  useEffect(() => {
    let cancelled = false;
    void adapters.secrets
      .get("anthropic_api_key")
      .then((value) => {
        if (!cancelled) setKeyStatus(value === null ? "not_set" : "saved");
      })
      .catch(() => {
        if (!cancelled) setKeyStatus("not_set");
      });
    void adapters.systemState
      .capabilities()
      .then((value) => {
        if (!cancelled) setCapabilities(value);
      })
      .catch(() => {
        if (!cancelled) setCapabilities({ fullDiskAccess: null });
      });
    return () => {
      cancelled = true;
    };
  }, [adapters]);

  const { provider, assistant } = settings.explainer;
  const { developerMode } = settings;
  const setProvider = (next: ExplainerProvider) => updateSettings({ explainer: { ...settings.explainer, provider: next } });
  const setAssistant = (next: Assistant) => updateSettings({ explainer: { ...settings.explainer, assistant: next } });
  const setDeveloperMode = (next: boolean) => {
    // Leaving Developer mode hides the in-app providers, so fall back to the browser hand-off.
    const explainer = !next && isInAppProvider(provider) ? { ...settings.explainer, provider: "browser" as const } : settings.explainer;
    updateSettings({ developerMode: next, explainer });
  };

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    const value = keyDraft.trim();
    if (value.length === 0) return;
    try {
      await adapters.secrets.set("anthropic_api_key", value);
      setKeyDraft("");
      setKeyStatus("saved");
      setKeyError(null);
    } catch {
      setKeyError("The key could not be saved to the Keychain.");
    }
  }

  async function removeKey() {
    try {
      await adapters.secrets.delete("anthropic_api_key");
      setKeyStatus("not_set");
      setKeyError(null);
      // The Remove button unmounts with the status change; the key field is the next sensible place.
      keyInput.current?.focus();
    } catch {
      setKeyError("The key could not be removed from the Keychain.");
    }
  }

  async function installLicense(event: FormEvent) {
    event.preventDefault();
    const key = licenseDraft.trim();
    if (key.length === 0) return;
    setLicenseBusy(true);
    try {
      const state = await adapters.license.install(key);
      setLicenseResult(state);
      // A rejected key is not stored, so the app's licence state only changes on success.
      if (state.status === "valid") {
        setLicense(state);
        setLicenseDraft("");
      }
    } catch {
      setLicenseResult({ status: "invalid", reason: "format" });
    } finally {
      setLicenseBusy(false);
    }
  }

  async function removeLicense() {
    setLicenseBusy(true);
    try {
      await adapters.license.remove();
      setLicense({ status: "none" });
      setLicenseResult(null);
    } finally {
      setLicenseBusy(false);
    }
  }

  const claudeModelOk = modelIdOk(settings.explainer.claudeModel, CLAUDE_MODEL);
  const ollamaModelOk = modelIdOk(settings.explainer.ollamaModel, OLLAMA_MODEL);
  const licenseInvalid = licenseResult !== null && licenseResult.status === "invalid";

  return (
    <main className="screen settings">
      <h1>Settings</h1>

      <section className="card" aria-labelledby="explainer-heading">
        <h2 id="explainer-heading">AI help</h2>
        <p className="muted">
          Optional. Only the check-up results go to the AI: rule ids, statuses and numbers. File names, folder paths
          and file contents never leave this Mac. Without AI help the app still shows every finding and fix.
        </p>
        <fieldset>
          <legend>Where to get AI help</legend>
          <label>
            <input type="radio" name="provider" checked={provider === "browser"} onChange={() => setProvider("browser")} />
            Open in Claude or ChatGPT (uses your own account, no key needed)
          </label>
          {provider === "browser" && (
            <fieldset className="sub-options">
              <legend>Which assistant</legend>
              <label>
                <input type="radio" name="assistant" checked={assistant === "claude"} onChange={() => setAssistant("claude")} />
                Claude
              </label>
              <label>
                <input type="radio" name="assistant" checked={assistant === "chatgpt"} onChange={() => setAssistant("chatgpt")} />
                ChatGPT
              </label>
            </fieldset>
          )}
          <label>
            <input type="radio" name="provider" checked={provider === "none"} onChange={() => setProvider("none")} />
            Off
          </label>
          {developerMode && (
            <>
              <label>
                <input type="radio" name="provider" checked={provider === "claude"} onChange={() => setProvider("claude")} />
                Claude API key
              </label>
              <label>
                <input type="radio" name="provider" checked={provider === "ollama"} onChange={() => setProvider("ollama")} />
                Local Ollama
              </label>
            </>
          )}
        </fieldset>
        {!developerMode && (
          <p className="muted small">Developer mode, below, adds a Claude API key and a local Ollama model as options.</p>
        )}

        {developerMode && provider === "claude" && (
          <div className="subsection">
            <form onSubmit={saveKey} className="inline-form">
              <label htmlFor="api-key">Anthropic API key</label>
              <p className="muted small">
                Stored in the macOS Keychain. Status:{" "}
                <strong>{keyStatus === "saved" ? "saved" : keyStatus === "not_set" ? "not set" : "checking"}</strong>
              </p>
              <div className="field-row">
                <input
                  id="api-key"
                  ref={keyInput}
                  type="password"
                  autoComplete="off"
                  value={keyDraft}
                  placeholder={keyStatus === "saved" ? "Enter a new key to replace it" : "sk-ant-..."}
                  onChange={(event) => setKeyDraft(event.target.value)}
                />
                <button type="submit" className="button" disabled={keyDraft.trim().length === 0}>
                  Save
                </button>
                {keyStatus === "saved" && (
                  <button type="button" className="button button-ghost" onClick={() => void removeKey()}>
                    Remove
                  </button>
                )}
              </div>
              {keyError !== null && (
                <p className="notice" role="alert">
                  {keyError}
                </p>
              )}
            </form>
            <label htmlFor="claude-model">Model id</label>
            <input
              id="claude-model"
              type="text"
              value={settings.explainer.claudeModel}
              maxLength={MAX_MODEL_ID_LENGTH}
              aria-invalid={!claudeModelOk}
              aria-describedby={claudeModelOk ? undefined : "claude-model-error"}
              onChange={(event) => updateSettings({ explainer: { ...settings.explainer, claudeModel: event.target.value.trim() } })}
            />
            {!claudeModelOk && (
              <p className="notice" id="claude-model-error">
                Model ids look like claude-opus-5 and are at most {MAX_MODEL_ID_LENGTH} characters.
              </p>
            )}
          </div>
        )}

        {developerMode && provider === "ollama" && (
          <div className="subsection">
            <label htmlFor="ollama-model">Model name</label>
            <input
              id="ollama-model"
              type="text"
              value={settings.explainer.ollamaModel}
              maxLength={MAX_MODEL_ID_LENGTH}
              aria-invalid={!ollamaModelOk}
              aria-describedby={ollamaModelOk ? undefined : "ollama-model-error"}
              onChange={(event) => updateSettings({ explainer: { ...settings.explainer, ollamaModel: event.target.value.trim() } })}
            />
            {!ollamaModelOk && (
              <p className="notice" id="ollama-model-error">
                Model names use lowercase letters, digits, dots, colons and dashes, at most {MAX_MODEL_ID_LENGTH}{" "}
                characters.
              </p>
            )}
            <p className="muted small">Ollama must be running on this Mac at 127.0.0.1:11434.</p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="developer-heading">
        <h2 id="developer-heading">Developer mode</h2>
        <label className="toggle">
          <input
            type="checkbox"
            role="switch"
            aria-checked={developerMode}
            checked={developerMode}
            onChange={(event) => setDeveloperMode(event.target.checked)}
          />
          <span>Developer mode</span>
        </label>
        <p className="muted">{DEVELOPER_MODE_COPY}</p>
      </section>

      <section className="card" aria-labelledby="profile-heading">
        <h2 id="profile-heading">About you</h2>
        <p className="muted">Used to tailor explanations. Stays on this Mac.</p>
        <ProfileForm value={settings.profile} onChange={(profile) => updateSettings({ profile })} idPrefix="settings" />
        <p className="muted small">Terminal commands are shown by Developer mode, above.</p>
      </section>

      <section className="card" aria-labelledby="fda-heading">
        <h2 id="fda-heading">Full Disk Access</h2>
        <p>
          Status:{" "}
          <strong>
            {capabilities === null
              ? "checking"
              : capabilities.fullDiskAccess === true
                ? "granted"
                : capabilities.fullDiskAccess === false
                  ? "not granted"
                  : "could not tell"}
          </strong>
        </p>
        <p className="muted">
          Needed only to read the extension folders of Chrome, Brave, Edge and Arc. Open Privacy & Security, choose
          Full Disk Access, switch on Talos Labs, then run the check-up again.
        </p>
        <button type="button" className="button" onClick={() => void adapters.openSettingsPane("full_disk_access")}>
          Open
        </button>
      </section>

      <section className="card" aria-labelledby="licence-heading">
        <h2 id="licence-heading">Licence</h2>
        {license.status === "valid" ? (
          <div>
            <p ref={licensedLine} tabIndex={-1}>
              Licensed: {license.payload.plan} plan, {license.payload.seats}{" "}
              {license.payload.seats === 1 ? "seat" : "seats"}, updates until {license.payload.updatesUntil}.
            </p>
            <button type="button" className="button button-ghost" onClick={() => void removeLicense()} disabled={licenseBusy}>
              Remove licence
            </button>
          </div>
        ) : (
          <form onSubmit={installLicense} className="inline-form">
            <p className="muted">
              {license.status === "invalid"
                ? `The stored key is not valid: ${LICENSE_INVALID_LABELS[license.reason]}`
                : "No licence yet. The three most valuable fixes are free."}
            </p>
            <label htmlFor="licence-key">Licence key</label>
            <div className="field-row">
              <input
                id="licence-key"
                ref={licenseInput}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={licenseDraft}
                placeholder="TL1..."
                aria-invalid={licenseInvalid}
                aria-describedby={licenseInvalid ? "licence-error" : undefined}
                onChange={(event) => setLicenseDraft(event.target.value)}
              />
              <button type="submit" className="button" disabled={licenseBusy || licenseDraft.trim().length === 0}>
                Activate
              </button>
            </div>
            {licenseResult !== null && licenseResult.status === "invalid" && (
              <p className="notice" id="licence-error" role="alert">
                {LICENSE_INVALID_LABELS[licenseResult.reason]}
              </p>
            )}
          </form>
        )}
      </section>
    </main>
  );
}
