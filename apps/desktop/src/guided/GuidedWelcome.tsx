import { useState } from "react";
import { useGuidedHero } from "./GuidedShell";
import { StepFrame } from "./StepFrame";
import { WELCOME } from "./copy";

/** First launch on the guided home. "Start" saves the default profile and starts the paced scan. */
export function GuidedWelcome({ onStart }: { onStart(): void }) {
  const [open, setOpen] = useState(false);
  useGuidedHero(true, false);
  return (
    <StepFrame
      progress={null}
      title={WELCOME.title}
      body={<p>{WELCOME.body}</p>}
      primary={{ label: WELCOME.start, onClick: onStart }}
      link={{ label: open ? WELCOME.back : WELCOME.what, onClick: () => setOpen((o) => !o) }}
      className="guided-welcome"
    >
      {open && (
        <div className="guided-reads read-columns">
          <section aria-labelledby="guided-reads">
            <h2 id="guided-reads">Reads</h2>
            <p>{WELCOME.reads}</p>
          </section>
          <section aria-labelledby="guided-never">
            <h2 id="guided-never">Never reads</h2>
            <p>{WELCOME.neverReads}</p>
          </section>
        </div>
      )}
    </StepFrame>
  );
}
