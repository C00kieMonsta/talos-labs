import { useEffect, useRef, useState } from "react";
import type { Evidence, Finding, Fix, FixChoice, SettingsPane } from "@talos/core";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { renderCommands } from "../app/placeholders";
import { ICONS } from "../app/icons";
import { EFFORT_LABELS, SIDE_EFFECT_LABELS, formatTime } from "../app/labels";
import type { DeveloperSettings } from "../settings";
import type { FixingState, WatchingState } from "../scan/machine";

/** A step that points at a command or at Terminal makes no sense on its own once commands are hidden. */
const MENTIONS_COMMAND = /\b(command|commands|terminal)\b/i;

/** Shown without Developer mode when a settings path or steps exist but a command is still needed. */
export const TERMINAL_HINT = "Part of this fix needs Terminal. Turn on Developer mode in Settings to see the exact command.";

/** Shown without Developer mode when Terminal is the only way to do the fix. */
export const TERMINAL_ONLY_HINT = "This fix is done in Terminal. Turn on Developer mode in Settings to see the commands.";

export const WATCH_LABEL = "Watch for the change";
export const REVEAL_LABEL = "Reveal in Finder";
export const OPEN_SETTINGS_LABEL = "Open System Settings";

/** True when hiding the commands would leave the reader without a complete fix. */
export function needsTerminalHint(fix: Fix): boolean {
  if (fix.commands.length === 0) return false;
  if (fix.settingsPath === null && fix.steps.length === 0) return true;
  return fix.steps.some((step) => MENTIONS_COMMAND.test(step));
}

/** Every path the evidence names, for the choice a fix needs. */
export function pathChoices(evidence: readonly Evidence[]): readonly { key: string; label: string; path: string }[] {
  const out: { key: string; label: string; path: string }[] = [];
  for (const entry of evidence) if (entry.value.kind === "path") out.push({ key: entry.key, label: entry.label, path: entry.value.value });
  return out;
}

export function choiceFor(finding: Finding, path: string | null): FixChoice | null {
  const apply = finding.fix.apply;
  if (apply.kind === "in_app") {
    if (apply.choice === "none" || apply.choice === "all_ssh_keys") return { kind: "none" };
    if (path === null) return null;
    return { kind: apply.choice, path };
  }
  if (apply.reveal === null || path === null) return null;
  return { kind: apply.reveal, path };
}

export interface FixCardProps {
  finding: Finding;
  developer: DeveloperSettings;
  /** The fix state for this rule, if any. */
  fixing: FixingState | null;
  watching: WatchingState | null;
  /** Another fix is running, so Apply waits. */
  busy?: boolean;
  onApply(choice: FixChoice): void;
  onOpenPane(pane: SettingsPane): void;
  onReveal(choice: FixChoice): void;
  onWatch(): void;
}

export function FixCard({ finding, developer, fixing, watching, busy = false, onApply, onOpenPane, onReveal, onWatch }: FixCardProps) {
  const { fix, evidence, points } = finding;
  const apply = fix.apply;
  const showCommands = developer.enabled && developer.showCommands;
  const commands = showCommands ? renderCommands(fix, evidence) : [];
  const hint = !showCommands && needsTerminalHint(fix);
  const terminalOnly = fix.settingsPath === null;
  const paths = pathChoices(evidence);
  const [picked, setPicked] = useState<string | null>(paths[0]?.path ?? null);
  const needsPath = apply.kind === "in_app" ? apply.choice === "share" || apply.choice === "ssh_key" : apply.reveal !== null;
  const choice = choiceFor(finding, picked);
  const verb = apply.kind === "in_app" ? apply.confirmVerb : null;
  const passedAt = watching?.ruleId === finding.ruleId && watching.passedAt !== null ? watching.passedAt : null;
  const strip = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (passedAt !== null) strip.current?.focus();
  }, [passedAt]);
  const donePass = fixing?.plan.ruleId === finding.ruleId && fixing.phase === "done" && fixing.result === "pass";

  return (
    <section className="card fix-card" aria-labelledby="fix-heading">
      <div className="fix-card-head">
        <h2 id="fix-heading">How to fix it</h2>
        {points > 0 && <span className="points-pill">+{points} points when fixed</span>}
      </div>
      <p className="fix-summary">{fix.summary}</p>

      {needsPath && paths.length > 1 && (
        <label className="field-row">
          <span>Which one</span>
          <select value={picked ?? ""} onChange={(e) => setPicked(e.target.value)}>
            {paths.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="fix-action-row">
        {apply.kind === "in_app" && (
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              if (!busy && choice !== null) onApply(choice);
            }}
            aria-disabled={busy || choice === null}
          >
            <Icon icon={ICONS.fix} /> {verb}
            {apply.needsPassword ? "…" : ""}
          </button>
        )}
        {apply.kind === "deep_link" && (
          <button type="button" className="button button-primary" onClick={() => onOpenPane(apply.pane)}>
            <Icon icon={ICONS.external} /> {OPEN_SETTINGS_LABEL}
          </button>
        )}
        {apply.kind !== "in_app" && apply.reveal !== null && choice !== null && (
          <button type="button" className="button" onClick={() => onReveal(choice)}>
            <Icon icon={ICONS.reveal} /> {REVEAL_LABEL}
          </button>
        )}
        {apply.kind === "manual" && apply.watch.length > 0 && (
          <button type="button" className="button" onClick={onWatch}>
            <Icon icon={ICONS.clock} /> {WATCH_LABEL}
          </button>
        )}
        {apply.kind === "in_app" && (
          <span className="fix-action-caption muted small">
            {apply.needsPassword ? "macOS will ask for your password." : "No password is needed."}
          </span>
        )}
      </div>

      {(passedAt !== null || donePass || (watching?.ruleId === finding.ruleId && passedAt === null)) && (
        <p
          ref={strip}
          tabIndex={-1}
          role="status"
          className={`status-strip ${passedAt !== null || donePass ? "status-strip-passed" : "status-strip-watching"}`}
        >
          {passedAt !== null ? (
            <>
              <Icon icon={ICONS.check} /> Now passes, checked at {formatTime(passedAt)}
            </>
          ) : donePass ? (
            <>
              <Icon icon={ICONS.check} /> Now passes
            </>
          ) : (
            <>
              <Icon icon={ICONS.spinner} className="spin" /> Watching for the change
              {watching?.lastPollAt != null && <span className="muted">, last checked at {formatTime(watching.lastPollAt)}</span>}
            </>
          )}
        </p>
      )}

      {fix.settingsPath !== null && (
        <div className="fix-settings">
          <p className="label">In {fix.settingsPath[0]}</p>
          <p className="settings-path">
            {fix.settingsPath.map((label, index) => (
              <span key={index}>
                {index > 0 && (
                  <>
                    <span className="path-sep" aria-hidden="true"> › </span>
                    <span className="visually-hidden">, then </span>
                  </>
                )}
                {label}
              </span>
            ))}
          </p>
          {fix.settingsPane !== null && apply.kind !== "deep_link" && (
            <button type="button" className="button button-small" onClick={() => onOpenPane(fix.settingsPane as SettingsPane)} aria-label="Open this settings pane">
              Open
            </button>
          )}
        </div>
      )}

      {commands.length > 0 && (
        <div className="fix-commands">
          <p className="label">{terminalOnly ? "In Terminal" : "If you prefer Terminal"}</p>
          <ul className="command-list">
            {commands.map((command, index) => (
              <li key={index} className="command">
                <code className="mono">{command.text}</code>
                <CopyButton text={command.text} subject={commands.length > 1 ? `command ${index + 1}` : "command"} />
                {command.interactive && <span className="muted small command-note">Prompts for input</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {fix.steps.length > 0 && (
        <div className="fix-steps">
          <p className="label">Steps</p>
          <ol>
            {fix.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {hint && <p className="muted small fix-terminal-hint">{terminalOnly ? TERMINAL_ONLY_HINT : TERMINAL_HINT}</p>}

      {fix.verify !== null && (
        <div className="fix-verify">
          <p className="label">How to check it worked</p>
          <p>{fix.verify}</p>
        </div>
      )}

      <dl className="fix-meta">
        <div>
          <dt>Effort</dt>
          <dd>{EFFORT_LABELS[fix.effort]}</dd>
        </div>
        <div>
          <dt>Side effects</dt>
          <dd>{SIDE_EFFECT_LABELS[fix.sideEffects]}</dd>
        </div>
      </dl>
    </section>
  );
}
