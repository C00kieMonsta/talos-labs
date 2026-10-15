import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Capabilities, LicenseState } from "@talos/core";
import { ProfileForm } from "../components/ProfileForm";
import { useApp } from "../app/context";
import { LICENSE_INVALID_LABELS } from "../app/labels";
import type { ExplainerSettings } from "../settings";

type Provider = ExplainerSettings["provider"];
type KeyStatus = "unknown" | "saved" | "not_set";

const CLAUDE_MODEL = /^claude-[a-z0-9-]+$/;
const OLLAMA_MODEL = /^[a-z0-9._:-]+$/;

export function Settings() {
  const { settings, updateSettings, adapters, license, setLicense } = useApp();
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("unknown");
  const [keyDraft, setKeyDraft] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [licenseDraft, setLicenseDraft] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseResult, setLicenseResult] = useState<LicenseState | null>(null);

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

  const setProvider = (provider: Provider) => updateSettings({ explainer: { ...settings.explainer, provider } });

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
      setLicense(state);
      if (state.status === "valid") setLicenseDraft("");
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

  const claudeModelOk = CLAUDE_MODEL.test(settings.explainer.claudeModel);
  const ollamaModelOk = OLLAMA_MODEL.test(settings.explainer.ollamaModel);

  return (
    <main className="screen settings">
      <h1>Settings</h1>

      <section className="card" aria-labelledby="explainer-heading">
        <h2 id="explainer-heading">AI explanations</h2>
        <p className="muted">
          Optional. The app sends rule ids, statuses and numbers, never anything written on your Mac. Without a
          provider the app still shows every finding and fix.
        </p>
        <fieldset>
          <legend>Provider</legend>
          <label>
            <input type="radio" name="provider" checked={settings.explainer.provider === "none"} onChange={() => setProvider("none")} />
            None
          </label>
          <label>
            <input type="radio" name="provider" checked={settings.explainer.provider === "claude"} onChange={() => setProvider("claude")} />
            Claude (Anthropic API)
          </label>
          <label>
            <input type="radio" name="provider" checked={settings.explainer.provider === "ollama"} onChange={() => setProvider("ollama")} />
            Ollama on this Mac
          </label>
        </fieldset>

        {settings.explainer.provider === "claude" && (
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
              {keyError !== null && <p className="notice">{keyError}</p>}
            </form>
            <label htmlFor="claude-model">Model id</label>
            <input
              id="claude-model"
              type="text"
              value={settings.explainer.claudeModel}
              aria-invalid={!claudeModelOk}
              onChange={(event) => updateSettings({ explainer: { ...settings.explainer, claudeModel: event.target.value.trim() } })}
            />
            {!claudeModelOk && <p className="notice">Model ids look like claude-opus-5.</p>}
          </div>
        )}

        {settings.explainer.provider === "ollama" && (
          <div className="subsection">
            <label htmlFor="ollama-model">Model name</label>
            <input
              id="ollama-model"
              type="text"
              value={settings.explainer.ollamaModel}
              aria-invalid={!ollamaModelOk}
              onChange={(event) => updateSettings({ explainer: { ...settings.explainer, ollamaModel: event.target.value.trim() } })}
            />
            {!ollamaModelOk && <p className="notice">Model names use lowercase letters, digits, dots, colons and dashes.</p>}
            <p className="muted small">Ollama must be running on this Mac at 127.0.0.1:11434.</p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="profile-heading">
        <h2 id="profile-heading">About you</h2>
        <p className="muted">Used to tailor explanations. Stays on this Mac.</p>
        <ProfileForm value={settings.profile} onChange={(profile) => updateSettings({ profile })} idPrefix="settings" />
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
            <p>
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
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={licenseDraft}
                placeholder="TL1..."
                onChange={(event) => setLicenseDraft(event.target.value)}
              />
              <button type="submit" className="button" disabled={licenseBusy || licenseDraft.trim().length === 0}>
                Activate
              </button>
            </div>
            {licenseResult !== null && licenseResult.status === "invalid" && (
              <p className="notice">{LICENSE_INVALID_LABELS[licenseResult.reason]}</p>
            )}
          </form>
        )}
      </section>
    </main>
  );
}
