import { useState } from "react";
import { NEVER_READS, READS } from "../screens/Welcome";
import { StepFrame } from "./StepFrame";
import { WELCOME } from "./copy";

/** First launch on the guided home. "Start" saves the default profile and starts the paced scan. */
export function GuidedWelcome({ onStart }: { onStart(): void }) {
  const [open, setOpen] = useState(false);
  return (
    <StepFrame
      progress={null}
      title={WELCOME.title}
      body={<p>{WELCOME.body}</p>}
      primary={{ label: WELCOME.start, onClick: onStart }}
      link={{ label: WELCOME.what, onClick: () => setOpen((o) => !o) }}
      className="guided-welcome"
    >
      {open && (
        <div className="guided-reads two-col">
          <section aria-labelledby="guided-reads">
            <h2 id="guided-reads">Reads</h2>
            <ul className="plain-list">
              {READS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="guided-never">
            <h2 id="guided-never">Never reads</h2>
            <ul className="plain-list">
              {NEVER_READS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </StepFrame>
  );
}
