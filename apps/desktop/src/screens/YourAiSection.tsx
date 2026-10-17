import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AiAvailability } from "@talos/core";
import { useApp } from "../app/context";
import { AI_AVAILABILITY_LABELS, PROVIDER_NAMES, YOUR_AI, aiPillWord } from "../app/labels";

/** A section title over a bordered group; each direct child of the group is one 64 px row. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="settings-section" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="section-title">
        {title}
      </h2>
      <div className="settings-group">{children}</div>
    </section>
  );
}

/** The kit's two-line row: the title in bold, one small line under it, the switch at the right. */
export function Switch({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange(next: boolean): void }) {
  const id = useId();
  return (
    <label className="toggle setting-row">
      <span className="setting-text">
        <strong id={`${id}-label`}>{label}</strong>
        {description !== undefined && <small id={`${id}-description`}>{description}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description === undefined ? undefined : `${id}-description`}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

/** States in which no ChatGPT or Claude sign-in exists on this Mac, so there is nothing to disconnect. */
const NOT_SIGNED_IN: readonly AiAvailability[] = ["not_connected", "not_offered", "connecting"];

export interface YourAiSectionProps {
  /** null until the first probe has answered. */
  aiAvailability: AiAvailability | null;
  /** The one Apple Intelligence button (Open Apple Intelligence settings, Try again). */
  onAiAction(state: AiAvailability): void;
  /** Change: opens the Connect screen. */
  onChangeAi(): void;
  /** False when the Connect screen would offer no row at all (nothing to connect and this Mac cannot run it); Change is then hidden. */
  canChange?: boolean;
  /** Disconnect: clears the stored sign-in; the caller probes again. False when the sign-in could not be cleared. */
  onDisconnect(): Promise<boolean>;
}

/** Settings "Your AI": the provider row with its pill and buttons, the switch, and the one privacy sentence. */
export function YourAiSection({ aiAvailability, onAiAction, onChangeAi, canChange = true, onDisconnect }: YourAiSectionProps) {
  const { settings, updateSettings } = useApp();
  const id = useId();
  const [busy, setBusy] = useState(false);
  /** The last Disconnect was refused: the sign-in is still on this Mac and the row says so. */
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  const rowText = useRef<HTMLSpanElement>(null);
  const { provider, aiEnabled } = settings.explainer;
  const state = aiEnabled ? aiAvailability : null;
  const label = state === null ? null : AI_AVAILABILITY_LABELS[state];
  const subscription = provider === "chatgpt" || provider === "claude_plan";
  // With the switch off nothing probes, so the stored sign-in is assumed; ai_disconnect is a no-op when there is none.
  const canDisconnect = subscription && (!aiEnabled || (state !== null && !NOT_SIGNED_IN.includes(state)));

  async function disconnect() {
    // The button is never disabled while busy: a disabled button drops keyboard focus to the body in WebKit and Chromium.
    if (busy) return;
    setBusy(true);
    setDisconnectFailed(false);
    let cleared = false;
    try {
      cleared = await onDisconnect();
    } finally {
      setBusy(false);
      setDisconnectFailed(!cleared);
      // The Disconnect button goes away with the state change; the row text is the next sensible place. A refused Disconnect keeps the button and the focus.
      if (cleared) rowText.current?.focus();
    }
  }

  return (
    <Section id="ai" title={YOUR_AI.title}>
      <div className="setting-row your-ai-row">
        <span ref={rowText} tabIndex={-1} className="setting-text">
          <strong id={`${id}-label`}>{YOUR_AI.title}</strong>
          <small className="your-ai-name">{PROVIDER_NAMES[provider]}</small>
        </span>
        {aiEnabled && (
          <span className={state === "available" ? "pill pill-accent your-ai-pill" : "pill your-ai-pill"} data-state={state ?? "checking"}>
            {state === null ? "Checking" : aiPillWord(provider, state)}
          </span>
        )}
        <div className="your-ai-actions">
          {state !== null && label !== null && label.action !== null && (
            <button type="button" className="toolbar-button" onClick={() => onAiAction(state)}>
              {label.action}
            </button>
          )}
          {canChange && (
            <button type="button" className="toolbar-button" onClick={onChangeAi} aria-describedby={`${id}-label`}>
              {YOUR_AI.change}
            </button>
          )}
          {canDisconnect && (
            <button type="button" className="toolbar-button" onClick={() => void disconnect()} aria-busy={busy} aria-describedby={`${id}-label`}>
              {YOUR_AI.disconnect}
            </button>
          )}
        </div>
        {disconnectFailed && canDisconnect && (
          <p className="muted small your-ai-note" role="alert">
            {YOUR_AI.disconnectFailed}
          </p>
        )}
      </div>
      <Switch label={YOUR_AI.switch} checked={aiEnabled} onChange={(next) => updateSettings({ explainer: { ...settings.explainer, aiEnabled: next } })} />
      <p className="muted">{YOUR_AI.sentence}</p>
    </Section>
  );
}
