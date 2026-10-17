import { useState } from "react";
import { useApp } from "../app/context";
import { useWatchController } from "../watch/watch-controller";
import { useGuidedHero } from "./GuidedShell";
import { StepFrame } from "./StepFrame";
import { WELCOME } from "./copy";

/** First launch on the guided home. "Start" saves the default profile and starts the paced scan. */
export function GuidedWelcome({ onStart }: { onStart(): void }) {
  const [open, setOpen] = useState(false);
  const watch = useWatchController();
  const { gate, settings } = useApp();
  useGuidedHero(true, false);
  // The one foreground button that asks macOS for notification permission; the flag is written after the answer.
  const allowNotifications = async () => {
    await watch.requestNotifyPermission().catch(() => undefined);
    await watch.setNotify(true).catch(() => undefined);
  };
  return (
    <StepFrame
      progress={null}
      title={WELCOME.title}
      body={<p>{WELCOME.body}</p>}
      primary={{ label: WELCOME.start, onClick: onStart }}
      link={{ label: open ? WELCOME.back : WELCOME.what, onClick: () => setOpen((o) => !o) }}
      className={settings.onboarded ? "guided-welcome" : "guided-welcome guided-welcome-first"}
    >
      {open && (
        <>
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
          {!gate.watchLocked && (
            <div className="fishy-welcome-watch">
              <p>{WELCOME.notAntivirus}</p>
              <button type="button" className="button button-small" onClick={() => void allowNotifications()}>
                {WELCOME.allowNotifications}
              </button>
            </div>
          )}
        </>
      )}
    </StepFrame>
  );
}
