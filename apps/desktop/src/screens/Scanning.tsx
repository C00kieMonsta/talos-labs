import type { SectionKey } from "@talos/core";
import { SECTION_KEYS } from "@talos/core";
import { SECTION_LABELS, SECTION_PROGRESS_LABELS } from "../app/labels";
import type { SectionProgressStatus } from "../scan/machine";

export function Scanning({
  sections,
  onCancel,
}: {
  sections: Record<SectionKey, SectionProgressStatus> | null;
  onCancel(): void;
}) {
  const done = sections === null ? 0 : SECTION_KEYS.filter((key) => sections[key] !== "pending").length;
  return (
    <main className="screen scanning">
      <header>
        <h1>Checking your Mac</h1>
        <p className="muted" aria-live="polite">
          {sections === null ? "Working out the results" : `${done} of ${SECTION_KEYS.length} areas checked`}
        </p>
      </header>
      <ol className="progress-list" aria-label="Progress by area">
        {SECTION_KEYS.map((key) => {
          const status = sections === null ? "ok" : sections[key];
          return (
            <li key={key} className={`progress-item progress-${status}`}>
              <span className="progress-dot" aria-hidden="true" />
              <span>
                {status === "pending" ? SECTION_PROGRESS_LABELS[key] : SECTION_LABELS[key]}
                {status === "ok" && <span className="visually-hidden">: checked</span>}
                {status === "unavailable" && <span className="muted">: could not be checked</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="actions">
        <button type="button" className="button button-ghost" onClick={onCancel} disabled={sections === null}>
          Cancel
        </button>
      </div>
    </main>
  );
}
