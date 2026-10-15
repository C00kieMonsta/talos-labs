import { useEffect, useRef, useState } from "react";
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
  // Counts areas that finished either way, so the figure matches the list below it.
  const done = sections === null ? 0 : SECTION_KEYS.filter((key) => sections[key] !== "pending").length;
  const heading = useRef<HTMLHeadingElement>(null);
  // Set on the first click; the screen unmounts when the scan stops, so it never needs resetting.
  const [cancelling, setCancelling] = useState(false);

  // This screen replaces the shell, so it moves focus to its heading the way routed screens do.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  function cancel() {
    if (cancelling) return;
    setCancelling(true);
    onCancel();
  }

  return (
    <main className="screen scanning">
      <header className="scanning-head">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            Checking your Mac
          </h1>
          <p className="muted" aria-live="polite">
            {sections === null ? "Working out the results" : `${done} of ${SECTION_KEYS.length} areas done`}
          </p>
        </div>
        <button
          type="button"
          className="button button-ghost"
          onClick={cancel}
          disabled={sections === null || cancelling}
          aria-disabled={sections === null || cancelling}
        >
          {cancelling ? "Cancelling" : "Cancel"}
        </button>
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
    </main>
  );
}
