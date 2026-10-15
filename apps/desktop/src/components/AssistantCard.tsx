import { useState } from "react";
import { ASSISTANT_LABELS } from "../app/labels";
import type { Assistant } from "../settings";

export const ASSISTANT_OPEN_FAILED = "The browser could not be opened. Try again, or switch to the other assistant.";

const BODY: Readonly<Record<"item" | "results", string>> = {
  item: "Opens your own account in the browser with your check-up results and this item. Only the results go, never file names, paths or passwords.",
  results: "Opens your own account in the browser with your check-up results. Only the results go, never file names, paths or passwords.",
};

/** The browser hand-off: one button labelled by the chosen assistant and a link to switch. */
export function AssistantCard({
  assistant,
  target,
  onOpen,
  onSwitch,
}: {
  assistant: Assistant;
  /** "item" explains one finding; "results" explains the whole report. */
  target: "item" | "results";
  onOpen(): Promise<void>;
  onSwitch(assistant: Assistant): void;
}) {
  const [error, setError] = useState<string | null>(null);
  const name = ASSISTANT_LABELS[assistant];
  const other: Assistant = assistant === "claude" ? "chatgpt" : "claude";
  const label = target === "item" ? `Explain this in ${name}` : `Explain my results in ${name}`;

  function open() {
    setError(null);
    void onOpen().catch(() => setError(ASSISTANT_OPEN_FAILED));
  }

  return (
    <section className="card ai-card" aria-labelledby="assistant-heading">
      <h2 id="assistant-heading">AI help</h2>
      <p className="muted small">{BODY[target]}</p>
      {error !== null && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="button" className="button" onClick={open}>
          {label}
        </button>
        <button type="button" className="link-button small" onClick={() => onSwitch(other)}>
          Use {ASSISTANT_LABELS[other]} instead
        </button>
      </div>
    </section>
  );
}
