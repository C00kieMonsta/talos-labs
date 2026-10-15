import type { Evidence, Fix, SettingsPane } from "@talos/core";
import { CopyButton } from "./CopyButton";
import { renderCommands } from "../app/placeholders";
import { EFFORT_LABELS, SIDE_EFFECT_LABELS } from "../app/labels";

/** A step that points at a command or at Terminal makes no sense on its own once commands are hidden. */
const MENTIONS_COMMAND = /\b(command|commands|terminal)\b/i;

/** Shown without Developer mode when a settings path or steps exist but a command is still needed. */
export const TERMINAL_HINT =
  "Part of this fix needs Terminal. Turn on Developer mode in Settings to see the exact command.";

/** Shown without Developer mode when Terminal is the only way to do the fix. */
export const TERMINAL_ONLY_HINT =
  "This fix is done in Terminal. Turn on Developer mode in Settings to see the commands.";

/** True when hiding the commands would leave the reader without a complete fix. */
export function needsTerminalHint(fix: Fix): boolean {
  if (fix.commands.length === 0) return false;
  if (fix.settingsPath === null && fix.steps.length === 0) return true;
  return fix.steps.some((step) => MENTIONS_COMMAND.test(step));
}

export function FixCard({
  fix,
  evidence,
  points,
  developerMode,
  onOpenPane,
}: {
  fix: Fix;
  evidence: readonly Evidence[];
  points: number;
  /** Commands and their Copy buttons render only when true. */
  developerMode: boolean;
  onOpenPane(pane: SettingsPane): void;
}) {
  const commands = developerMode ? renderCommands(fix, evidence) : [];
  const hint = !developerMode && needsTerminalHint(fix);
  const terminalOnly = fix.settingsPath === null;
  return (
    <section className="card fix-card" aria-labelledby="fix-heading">
      <div className="fix-card-head">
        <h2 id="fix-heading">How to fix it</h2>
        {points > 0 && <span className="points-pill">+{points} points when fixed</span>}
      </div>
      <p className="fix-summary">{fix.summary}</p>

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
          {fix.settingsPane !== null && (
            <button
              type="button"
              className="button"
              onClick={() => onOpenPane(fix.settingsPane as SettingsPane)}
              aria-label="Open this settings pane"
            >
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
