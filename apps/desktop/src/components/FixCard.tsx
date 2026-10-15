import type { Evidence, Fix, SettingsPane } from "@talos/core";
import { CopyButton } from "./CopyButton";
import { renderCommands } from "../app/placeholders";
import { EFFORT_LABELS, SIDE_EFFECT_LABELS } from "../app/labels";

export function FixCard({
  fix,
  evidence,
  points,
  onOpenPane,
}: {
  fix: Fix;
  evidence: readonly Evidence[];
  points: number;
  onOpenPane(pane: SettingsPane): void;
}) {
  const commands = renderCommands(fix, evidence);
  return (
    <section className="card fix-card" aria-labelledby="fix-heading">
      <div className="fix-card-head">
        <h2 id="fix-heading">How to fix it</h2>
        {points > 0 && <span className="points-pill">+{points} points when fixed</span>}
      </div>
      <p className="fix-summary">{fix.summary}</p>

      {fix.settingsPath !== null && (
        <div className="fix-settings">
          <p className="label">In System Settings</p>
          <p className="settings-path" aria-label="Settings path">
            {fix.settingsPath.map((label, index) => (
              <span key={index}>
                {index > 0 && <span className="path-sep" aria-hidden="true"> › </span>}
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
          <p className="label">If you prefer Terminal</p>
          <ul className="command-list">
            {commands.map((command, index) => (
              <li key={index} className="command">
                <code className="mono">{command.text}</code>
                <CopyButton text={command.text} />
                {command.interactive && <span className="muted small">Prompts for input</span>}
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
