import { useEffect, useRef, useState } from "react";
import type { WatchPort, WatchState } from "@talos/core";
import { ICONS, SEVERITY_ICONS } from "../app/icons";
import { UNKNOWN_REASON_LABELS, WATCH_PROBE_LABELS } from "../app/labels";
import { Icon } from "../components/Icon";
import { FISHY, WATCH } from "../guided/copy";
import { checkedLabel } from "./relative-time";
import { useWatchStatus } from "./useWatch";

/** The window needs only the four commands the limited adapter exposes, and two of them. */
export type WatchWindowPort = Pick<WatchPort, "status" | "onState" | "checkNow" | "openMain">;

/** How often the "Checked N minutes ago" line is re-read. */
const CLOCK_MS = 60_000;

/** The count is of what is shown: look with no item (a rule appeared, a good flip, a hysteresis hold) carries no number, as the tray tooltip does. */
function statusWord(state: WatchState): string {
  if (state.rating === "act_now") return WATCH.act;
  if (state.rating === "keep_an_eye") {
    if (state.items.length === 0) return WATCH.look;
    return state.items.length === 1 ? WATCH.lookOne : WATCH.lookMany.replace("{n}", String(state.items.length));
  }
  return WATCH.calm;
}

/** One line per probe the sweep could not read, for the hover title. */
export function unavailableTitle(state: WatchState): string {
  return state.unavailable.map((probe) => `${WATCH_PROBE_LABELS[probe.probeId]}: ${UNKNOWN_REASON_LABELS[probe.reason]}`).join("\n");
}

function StatusLine({ state }: { readonly state: WatchState }) {
  const act = state.rating === "act_now";
  const icon = act ? SEVERITY_ICONS.critical : state.rating === "keep_an_eye" ? ICONS.info : ICONS.checkup;
  return (
    <div className={act ? "watch-status watch-status-act" : "watch-status"} role="status">
      <Icon icon={icon} size={20} className="watch-status-icon" />
      <span className="watch-status-word">{statusWord(state)}</span>
    </div>
  );
}

function MetaLine({ state, now }: { readonly state: WatchState; readonly now: Date }) {
  const unavailable = state.unavailable.length;
  const couldNot = unavailable === 0 ? null : unavailable === 1 ? WATCH.couldNotCheckOne : WATCH.couldNotCheck.replace("{n}", String(unavailable));
  const checked = state.checking ? null : state.lastCheckAt === null ? null : checkedLabel(state.lastCheckAt, now);
  if (!state.checking && checked === null && couldNot === null) return null;
  return (
    <p className="watch-meta">
      {state.checking ? (
        <span className="watch-meta-checking" role="status">
          <Icon icon={ICONS.spinner} className="watch-meta-icon" />
          {WATCH.checking}
        </span>
      ) : (
        checked !== null && <span>{checked}</span>
      )}
      {couldNot !== null && (
        <span className="watch-meta-unavailable" title={unavailableTitle(state)}>
          {couldNot}
        </span>
      )}
    </p>
  );
}

function TopItem({ state }: { readonly state: WatchState }) {
  const top = state.items[0];
  // A calm rating shows no item: "Nothing changed" and a headline cannot both be true.
  if (top === undefined || state.rating === "calm") return null;
  const rest = state.items.length - 1;
  const act = state.rating === "act_now";
  return (
    <div className="watch-item">
      <p className="watch-item-headline">{FISHY.noticed.headline[top.kind]}</p>
      <p className="watch-item-why">{WATCH.why[top.kind]}</p>
      {rest > 0 && <p className="watch-item-more">{rest === 1 ? WATCH.moreOne : WATCH.more.replace("{n}", String(rest))}</p>}
      {act && <p className="watch-item-source">{WATCH.sourceAct}</p>}
      {act && <p className="watch-item-evidence">{FISHY.evidence}</p>}
    </div>
  );
}

/** The 320 px menu bar window (docs/DESIGN-WATCH.md section 5). Not a guided step: one primary or none, two footer links. */
export function WatchWindow({ port, now = () => new Date() }: { readonly port: WatchWindowPort; readonly now?: () => Date }) {
  const state = useWatchStatus(port);
  const nowRef = useRef(now);
  nowRef.current = now;
  const [clock, setClock] = useState(now);
  useEffect(() => {
    const id = window.setInterval(() => setClock(nowRef.current()), CLOCK_MS);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    setClock(nowRef.current());
  }, [state]);

  const primary = state === null || state.firstRun || state.items.length === 0 ? null : state.rating === "act_now" ? WATCH.seeWhatToDo : state.rating === "keep_an_eye" ? WATCH.showMe : null;

  return (
    <main className="watch" aria-busy={state === null ? true : undefined}>
      {state !== null && state.firstRun && (
        <div className="watch-first-run">
          <p className="watch-first-run-text">{WATCH.firstRun}</p>
          <button type="button" className="watch-link" onClick={() => void port.openMain("settings_watch")}>
            {WATCH.startAtLogin}
          </button>
        </div>
      )}
      {state !== null && !state.firstRun && <StatusLine state={state} />}
      {state !== null && <MetaLine state={state} now={clock} />}
      {state !== null && !state.firstRun && <TopItem state={state} />}
      {primary !== null && (
        <button type="button" className="button button-primary watch-primary" onClick={() => void port.openMain("noticed")}>
          {primary}
        </button>
      )}
      <footer className="watch-footer">
        <button type="button" className="watch-link" onClick={() => void port.openMain("home")}>
          {WATCH.openApp}
        </button>
        <button type="button" className="watch-link" onClick={() => void port.checkNow()}>
          {WATCH.checkNow}
        </button>
      </footer>
    </main>
  );
}
