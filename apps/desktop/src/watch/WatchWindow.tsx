import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowUp } from "lucide-react";
import type { WatchJudge, WatchPort, WatchState } from "@talos/core";
import { WATCH_LIMITS } from "@talos/core";
import { ICONS, SEVERITY_ICONS } from "../app/icons";
import { formatTime, GRADE_LABELS, WATCH_PROBE_LABELS } from "../app/labels";
import { Icon } from "../components/Icon";
import { FISHY, WATCH } from "../guided/copy";
import { guidedFor } from "../guided/plan";
import { AI_BADGES_SHORT, reasonLabel, WATCH_WINDOW } from "./copy";
import { checkedLabel, nextCheckLabel } from "./relative-time";
import { useWatchStatus } from "./useWatch";

/** The window needs only the four commands the limited adapter exposes, and two of them. */
export type WatchWindowPort = Pick<WatchPort, "status" | "onState" | "checkNow" | "openMain">;

/** How often the "Checked N minutes ago" line is re-read. */
const CLOCK_MS = 60_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function plural(n: number, one: string, many: string): string {
  return (n === 1 ? one : many).replace("{n}", String(n));
}

/** The count is of what is shown: look with no item (a rule appeared, a good flip, a hysteresis hold) carries no number, as the tray tooltip does. */
function statusWord(state: WatchState): string {
  if (state.pausedUntil !== null) return WATCH_WINDOW.paused.replace("{time}", formatTime(state.pausedUntil));
  if (state.rating === "act_now") return WATCH.act;
  if (state.rating === "keep_an_eye") {
    if (state.items.length === 0) return WATCH.look;
    return state.items.length === 1 ? WATCH.lookOne : WATCH.lookMany.replace("{n}", String(state.items.length));
  }
  return WATCH.calm;
}

/** "a, b and c" from the probe labels. */
function joinAreas(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function withStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** The most areas the calm unreadable row names; more than this reads as the count. */
const UNREADABLE_MAX_AREAS = 3;
/** The longest areas sentence that stays within the row's three lines (60 px) at the window's font. */
const UNREADABLE_MAX_CHARS = 110;

/**
 * The calm window's visible unreadable row (docs/DESIGN-WATCH-WINDOW.md section 2): one probe, several with one reason, or
 * several reasons. The row is sized 60 px from Rust, which cannot see the labels, so a sentence over three lines (more than
 * three areas, or over 110 characters) falls back to the count.
 */
export function unavailableLine(state: WatchState): string {
  const probes = state.unavailable;
  if (probes.length === 0) return "";
  const reasons = Array.from(new Set(probes.map((probe) => probe.reason)));
  const first = probes[0];
  if (probes.length === 1 && first !== undefined) {
    return WATCH_WINDOW.couldNotCheckArea.replace("{area}", WATCH_PROBE_LABELS[first.probeId]).replace("{reason}", withStop(reasonLabel(first.reason)));
  }
  if (reasons.length === 1 && first !== undefined && probes.length <= UNREADABLE_MAX_AREAS) {
    const areas = joinAreas(probes.map((probe) => WATCH_PROBE_LABELS[probe.probeId]));
    const line = WATCH_WINDOW.couldNotCheckAreas.replace("{areas}", areas).replace("{reason}", withStop(reasonLabel(first.reason)));
    if (line.length <= UNREADABLE_MAX_CHARS) return line;
  }
  return WATCH_WINDOW.couldNotCheckMixed.replace("{n}", String(probes.length));
}

/** The authored calm sentence, from the date of the last change. */
export function calmLine(lastChangeAt: string | null, now: Date): string {
  if (lastChangeAt === null) return WATCH_WINDOW.calmStart;
  const then = new Date(lastChangeAt).getTime();
  if (Number.isNaN(then)) return WATCH_WINDOW.calmStart;
  const elapsed = Math.max(0, now.getTime() - then);
  if (elapsed < HOUR_MS) return WATCH_WINDOW.calmRecent;
  if (elapsed < DAY_MS) return plural(Math.floor(elapsed / HOUR_MS), WATCH_WINDOW.calmHour, WATCH_WINDOW.calmHours);
  return plural(Math.floor(elapsed / DAY_MS), WATCH_WINDOW.calmDay, WATCH_WINDOW.calmDays);
}

/** The look state with no item: the appeared count from the last check-up, else the changes of the last day. */
export function lookEmptyLine(state: WatchState): string {
  if (state.rulesSince !== null && state.rulesSince.appeared > 0) return plural(state.rulesSince.appeared, WATCH_WINDOW.lookEmptyNew, WATCH_WINDOW.lookEmptyNewMany);
  return plural(state.recentCount, WATCH_WINDOW.lookEmptyChange, WATCH_WINDOW.lookEmptyChanges);
}

/** The judge's line the window may draw: non-null, about the rating shown, and never On this Mac on calm (section 3, the state machine). */
function currentJudge(state: WatchState): WatchJudge | null {
  if (state.judge === null || state.judge.rating !== state.rating) return null;
  if (state.rating === "calm" && state.judge.provider === "apple") return null;
  return state.judge;
}

function StatusLine({ state }: { readonly state: WatchState }) {
  // The critical colour goes with the act-now word only; a pause is drawn in the neutral colour.
  const act = state.pausedUntil === null && state.rating === "act_now";
  const icon = state.pausedUntil !== null ? ICONS.pause : act ? SEVERITY_ICONS.critical : state.rating === "keep_an_eye" ? ICONS.info : ICONS.checkup;
  return (
    <div className={act ? "watch-status watch-status-act" : "watch-status"} role="status">
      {/* The live region stays one node; only the inner span remounts on a rating change. */}
      <span key={state.rating} className="watch-status-inner">
        <Icon icon={icon} size={20} className="watch-status-icon" />
        <span className="watch-status-word">{statusWord(state)}</span>
      </span>
    </div>
  );
}

function Checking() {
  return (
    <span className="watch-meta-checking" role="status">
      <Icon icon={ICONS.spinner} className="watch-meta-icon" />
      {WATCH.checking}
    </span>
  );
}

/** Calm: the time and the next check on two lines. Look, act and paused: one line with the count of unreadable areas, no hover. */
function MetaLine({ state, now }: { readonly state: WatchState; readonly now: Date }) {
  const checked = state.lastCheckAt === null ? null : checkedLabel(state.lastCheckAt, now);
  if (state.rating === "calm" && state.pausedUntil === null) {
    if (state.checking) {
      return (
        <p className="watch-meta">
          <Checking />
        </p>
      );
    }
    return (
      <p className="watch-meta">
        {checked !== null && <span className="watch-meta-checked">{checked}</span>}
        <span className="watch-meta-next">{nextCheckLabel(state.nextCheckAt, now, state.closeWatchUntil)}</span>
      </p>
    );
  }
  if (!state.checking && checked === null) return null;
  const unavailable = state.unavailable.length;
  const couldNot = unavailable === 0 ? null : unavailable === 1 ? WATCH.couldNotCheckOne : WATCH.couldNotCheck.replace("{n}", String(unavailable));
  return (
    <p className="watch-meta">
      {state.checking ? <Checking /> : <span className="watch-meta-checked">{checked}</span>}
      {couldNot !== null && <span className="watch-meta-unavailable">{couldNot}</span>}
    </p>
  );
}

/** The judge's sentence as text nodes with the short badge after it; never a control. */
function ReasonLine({ judge }: { readonly judge: WatchJudge }) {
  return (
    <p className="guided-model-line watch-model-line">
      {judge.reason} <span className="guided-model-badge">{AI_BADGES_SHORT[judge.provider]}</span>
    </p>
  );
}

function TopItem({ state, judge }: { readonly state: WatchState; readonly judge: WatchJudge | null }) {
  const top = state.items[0];
  // A calm rating shows no item: "Nothing changed" and a headline cannot both be true.
  if (top === undefined || state.rating === "calm") return null;
  const rest = state.items.length - 1;
  const act = state.rating === "act_now";
  return (
    <div className="watch-item">
      <p className="watch-item-headline">{FISHY.noticed.headline[top.kind]}</p>
      <p className="watch-item-why">{WATCH.why[top.kind]}</p>
      {!act && judge !== null && <ReasonLine judge={judge} />}
      {rest > 0 && <p className="watch-item-more">{rest === 1 ? WATCH.moreOne : WATCH.more.replace("{n}", String(rest))}</p>}
      {act && <p className="watch-item-source">{WATCH.sourceAct}</p>}
    </div>
  );
}

/** The last check-up's score and grade, and the plan's "Do this next" when it belongs to that report. */
function CheckupRow({ state, port }: { readonly state: WatchState; readonly port: WatchWindowPort }) {
  const { report, next } = state;
  const score =
    report === null
      ? WATCH_WINDOW.checkupNone
      : report.score === null || report.grade === null
        ? WATCH_WINDOW.checkupUnscored
        : WATCH_WINDOW.checkup.replace("{score}", String(report.score)).replace("{grade}", GRADE_LABELS[report.grade]);
  let headline: string | null = null;
  if (report !== null && next !== null && next.reportId === report.reportId) {
    // toWatchState and the demo only deliver catalogue ids; a stray one draws no link rather than throwing.
    try {
      headline = guidedFor(next.ruleId).headline;
    } catch {
      headline = null;
    }
  }
  return (
    <div className="watch-checkup">
      <p className="watch-checkup-score">{score}</p>
      {headline !== null && (
        <button type="button" className="watch-link watch-up-next" onClick={() => void port.openMain("home")}>
          <span className="watch-up-next-text">{WATCH_WINDOW.upNext.replace("{headline}", headline)}</span> <span aria-hidden="true">›</span>
        </button>
      )}
    </div>
  );
}

/** The one free-text control: a draft for the main window's composer, sent by the person's tap there. */
function AskField({ port }: { readonly port: WatchWindowPort }) {
  const [draft, setDraft] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = draft.trim();
    if (question.length === 0) return;
    void port.openMain("chat", question);
    setDraft("");
  };
  return (
    <form className="watch-ask" onSubmit={submit}>
      <input
        className="watch-ask-input"
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={WATCH_LIMITS.maxQuestionChars}
        placeholder={WATCH_WINDOW.askPlaceholder}
        aria-label={WATCH_WINDOW.askPlaceholder}
        autoComplete="off"
      />
      <button type="submit" className="watch-ask-send" aria-label={WATCH_WINDOW.send}>
        <Icon icon={ArrowUp} size={20} />
      </button>
    </form>
  );
}

/** The 320 px menu bar window (docs/DESIGN-WATCH-WINDOW.md section 2). Not a guided step: one primary or none, two footer links. */
export function WatchWindow({
  port,
  now = () => new Date(),
  connectOffer = () => false,
}: {
  readonly port: WatchWindowPort;
  readonly now?: () => Date;
  /** Whether the calm window may draw its Connect line; read on every state and every window focus, false on a throw. */
  readonly connectOffer?: () => boolean;
}) {
  const state = useWatchStatus(port);
  const nowRef = useRef(now);
  nowRef.current = now;
  const offerRef = useRef(connectOffer);
  offerRef.current = connectOffer;
  const mainRef = useRef<HTMLElement>(null);
  const [clock, setClock] = useState(now);
  const [offer, setOffer] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setClock(nowRef.current()), CLOCK_MS);
    return () => window.clearInterval(id);
  }, []);

  const readOffer = useCallback(() => {
    let next = false;
    try {
      next = offerRef.current() === true;
    } catch {
      next = false;
    }
    setOffer(next);
  }, []);

  // Focus lands on the field when present, else the primary, else "Open Talos Labs"; the window takes focus on each tray click.
  const focusFirst = useCallback(() => {
    const root = mainRef.current;
    if (root === null) return;
    const target = root.querySelector<HTMLElement>(".watch-ask-input") ?? root.querySelector<HTMLElement>(".watch-primary") ?? root.querySelector<HTMLElement>(".watch-footer .watch-link");
    target?.focus();
  }, []);

  useEffect(() => {
    setClock(nowRef.current());
    if (state === null) return;
    readOffer();
  }, [state, readOffer]);

  const focusedOnce = useRef(false);
  useEffect(() => {
    if (state === null || focusedOnce.current) return;
    focusedOnce.current = true;
    focusFirst();
  }, [state, focusFirst]);

  useEffect(() => {
    const onFocus = () => {
      readOffer();
      focusFirst();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [readOffer, focusFirst]);

  // The tray item exists only while the watch is active; an unlicensed state has nothing to show.
  if (state !== null && !state.licensed) return null;

  const paused = state !== null && !state.firstRun && state.pausedUntil !== null;
  const judge = state === null ? null : currentJudge(state);
  const top = state?.items[0];
  const calm = state !== null && !state.firstRun && !paused && state.rating === "calm";
  const look = state !== null && !state.firstRun && !paused && state.rating === "keep_an_eye";
  const act = state !== null && !state.firstRun && !paused && state.rating === "act_now";
  const primary = state === null || top === undefined ? null : act ? WATCH.seeWhatToDo : look ? WATCH.showMe : null;
  const lookEmptyPrimary = look && top === undefined;

  return (
    <main className="watch" aria-busy={state === null ? true : undefined} ref={mainRef}>
      {state !== null && state.firstRun && (
        <div className="watch-first-run">
          <p className="watch-first-run-text">{WATCH.firstRun}</p>
          <button type="button" className="watch-link" onClick={() => void port.openMain("settings_watch")}>
            {WATCH.startAtLogin}
          </button>
        </div>
      )}
      {state !== null && !state.firstRun && <StatusLine state={state} />}
      {state !== null && !state.firstRun && <MetaLine state={state} now={clock} />}
      {paused && state !== null && <p className="watch-paused-line">{WATCH_WINDOW.pausedLine}</p>}
      {calm && state !== null && state.unavailable.length > 0 && <p className="watch-unreadable">{unavailableLine(state)}</p>}
      {calm && state !== null && (judge !== null ? <ReasonLine judge={judge} /> : <p className="watch-calm-line">{calmLine(state.lastChangeAt, clock)}</p>)}
      {calm && state !== null && <CheckupRow state={state} port={port} />}
      {calm && state !== null && state.ai.enabled && <AskField port={port} />}
      {calm && state !== null && !state.ai.enabled && offer && (
        <p className="watch-connect">
          {WATCH_WINDOW.connectLine}{" "}
          <button type="button" className="watch-link" onClick={() => void port.openMain("connect")}>
            {WATCH_WINDOW.connectLink} <span aria-hidden="true">›</span>
          </button>
        </p>
      )}
      {(look || act) && state !== null && top === undefined && <p className="watch-look-empty">{lookEmptyLine(state)}</p>}
      {(look || act) && state !== null && top === undefined && judge !== null && !act && <ReasonLine judge={judge} />}
      {(look || act) && state !== null && <TopItem state={state} judge={judge} />}
      {primary !== null && (
        <button type="button" className="button button-primary watch-primary" onClick={() => void port.openMain("noticed")}>
          {primary}
        </button>
      )}
      {lookEmptyPrimary && (
        <button type="button" className="button button-primary watch-primary" onClick={() => void port.openMain("home")}>
          {WATCH.showMe}
        </button>
      )}
      {act && judge !== null && <ReasonLine judge={judge} />}
      {look && state !== null && state.ai.enabled && (
        <button
          type="button"
          className="watch-link watch-ask-why"
          onClick={() => void port.openMain("chat", top === undefined ? WATCH_WINDOW.askWhatChanged : WATCH_WINDOW.askWhy(FISHY.noticed.headline[top.kind]))}
        >
          {top === undefined ? WATCH_WINDOW.askWhatChangedLink : WATCH_WINDOW.askLink}
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
