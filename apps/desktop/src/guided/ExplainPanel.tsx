import { useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { AiAvailability, RuleId } from "@talos/core";
import { useApp } from "../app/context";
import { EXPLAINER_FAILURE_LABELS, formatTime } from "../app/labels";
import type { AppleAiState } from "../app/labels";
import { ChatStreamContext } from "../chat/ChatStreamContext";
import { remoteOf } from "../chat/providers";
import { ModelText } from "../components/ModelText";
import { CONNECT_POLL_MS, notConnectedFor, useConnect } from "../scan/ai-connect";
import { REPROBE_SETTINGS_MS, limitReprobeMs } from "../scan/useAiAvailability";
import { CHAT, EXPLAIN } from "./copy";
import { guidedFor } from "./plan";

/** The v0.2 Apple Intelligence states; they render their honest line, never the connect pitch. */
const APPLE_STATES: readonly AiAvailability[] = ["device_not_eligible", "apple_intelligence_not_enabled", "model_not_ready", "helper_unavailable"];

function isAppleState(state: AiAvailability): state is AppleAiState {
  return APPLE_STATES.includes(state);
}

export interface ExplainPanelProps {
  readonly ruleId: RuleId;
  readonly others?: readonly RuleId[];
  /** False drops the panel's own live regions; the host speaks the state through onState instead (the chat). */
  readonly announce?: boolean;
  /** The state line to speak when it changes while open: checking, waiting, writing; null when none. */
  readonly onState?: (text: string | null) => void;
}

/** "Explain this": streams explain(ruleId) through the v0.2 chokepoint. Never on the path; collapses on advance. */
export function ExplainPanel({ ruleId, others = [], announce = true, onState }: ExplainPanelProps) {
  const { scan, ai, settings, adapters } = useApp();
  // One request at a time per provider: while the chat answers, the disclosure says so and asks nothing.
  const chatBusy = useContext(ChatStreamContext);
  const connect = useConnect();
  const { ensureOffered, consumeResume } = connect;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RuleId>(ruleId);
  useEffect(() => {
    setOpen(false);
    setTarget(ruleId);
  }, [ruleId]);
  // After the reset: a step whose disclosure asked to connect opens again once the sign-in is done.
  // The consumed id is kept so StrictMode's second effect run reopens after the reset effect closed it.
  const resumed = useRef<RuleId | null>(null);
  useEffect(() => {
    if (resumed.current === ruleId || consumeResume(ruleId)) {
      resumed.current = ruleId;
      setOpen(true);
    }
  }, [ruleId, consumeResume]);
  useEffect(() => {
    ensureOffered();
  }, [ensureOffered]);
  const availability = ai.availability;
  const { probe, reprobe, until } = ai;
  // A sign-in in progress, or one cancelled before the worker reported its end: re-read it until it settles.
  useEffect(() => {
    if (availability !== "connecting") return;
    return reprobe(CONNECT_POLL_MS);
  }, [availability, reprobe]);
  // The allowance comes back on its own: ask again at the provider's reset time.
  useEffect(() => {
    if (availability !== "limit_reached") return;
    const timer = setTimeout(() => void probe(true), limitReprobeMs(until));
    return () => clearTimeout(timer);
  }, [availability, until, probe]);
  // The controller object is rebuilt every render; the request runs when the intent changes, not on each render.
  const explainRef = useRef(scan.explain);
  explainRef.current = scan.explain;
  useEffect(() => {
    if (open && availability === "available" && !chatBusy) void explainRef.current(target);
  }, [open, target, availability, chatBusy]);
  const explain = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.explain : { kind: "off" as const };
  const streaming = explain.kind === "running" && explain.target === target;
  const partial = streaming ? explain.partial : null;
  const ready = explain.kind === "ready" || explain.kind === "failed" ? explain.byRule[target] : undefined;
  const failed = explain.kind === "failed" && explain.target === target ? explain.reason : null;
  // A failure that changed the provider's state: one cached probe per failure, so the body shows the state line instead.
  // The controller object is rebuilt every render and the probe sets state, so the effect keys on the stable probe.
  const stateFailure = failed === "needs_sign_in" || failed === "limit_reached" || failed === "provider_unavailable";
  const probedFor = useRef<typeof failed>(null);
  useEffect(() => {
    if (!stateFailure) {
      probedFor.current = null;
      return;
    }
    if (probedFor.current === failed) return;
    probedFor.current = failed;
    void probe();
  }, [stateFailure, failed, probe]);
  const text = ready?.whyItMattersForYou ?? partial?.whyItMattersForYou ?? null;
  const provider = settings.explainer.provider;
  const remote = remoteOf(provider);
  const status = announce ? "status" : undefined;
  const stateLine = availability === null ? EXPLAIN.checking : availability === "connecting" ? EXPLAIN.waiting : availability === "available" && streaming ? CHAT.writing : null;
  useEffect(() => {
    if (open && onState !== undefined) onState(stateLine);
  }, [open, stateLine, onState]);

  let body: ReactNode;
  if (availability === null) {
    body = (
      <p className="guided-meta" role={status}>
        {EXPLAIN.checking}
      </p>
    );
  } else if (notConnectedFor(provider, availability) && (connect.connectable || connect.offered === null)) {
    // The pitch; its buttons wait until the offered rows are known.
    body = (
      <div className="guided-explain-connect">
        <p>{connect.offered?.apple === true ? EXPLAIN.notConnectedApple : EXPLAIN.notConnected}</p>
        {connect.connectable && (
          <p className="guided-explain-line">
            <button type="button" className="guided-text-button" onClick={() => connect.open({ name: "guided" }, { explainRuleId: ruleId })}>
              {EXPLAIN.connect}
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                connect.notNow();
                setOpen(false);
              }}
            >
              {EXPLAIN.notNow}
            </button>
          </p>
        )}
      </div>
    );
  } else if (isAppleState(availability)) {
    // Nothing can be connected, or On this Mac is the chosen provider: the v0.2 line and its one button.
    const action =
      availability === "apple_intelligence_not_enabled" ? (
        <button
          type="button"
          className="guided-text-button"
          onClick={() => {
            void adapters.openSettingsPane("apple_intelligence");
            ai.reprobe(REPROBE_SETTINGS_MS);
          }}
        >
          {EXPLAIN.openAppleSettings}
        </button>
      ) : availability === "helper_unavailable" ? (
        <button type="button" className="guided-text-button" onClick={() => void ai.probe(true)}>
          {EXPLAIN.tryAgain}
        </button>
      ) : null;
    body = (
      <p className="guided-meta guided-explain-line">
        {EXPLAIN.apple[availability]}
        {action !== null && " "}
        {action}
      </p>
    );
  } else if (notConnectedFor(provider, availability)) {
    // The chosen provider is not offered by this build and no other row can be connected: say so, no button.
    body = <p className="guided-meta guided-explain-line">{EXPLAIN.notOffered[remote]}</p>;
  } else if (availability === "connecting") {
    body = (
      <p className="guided-meta" role={status}>
        {EXPLAIN.waiting}
      </p>
    );
  } else if (availability === "needs_sign_in") {
    body = (
      <p className="guided-meta guided-explain-line">
        {EXPLAIN.signedOut[remote]}{" "}
        <button type="button" className="guided-text-button" onClick={() => connect.signInAgain({ name: "guided" }, { explainRuleId: ruleId })}>
          {EXPLAIN.signInAgain}
        </button>
      </p>
    );
  } else if (availability === "limit_reached") {
    body = (
      <p className="guided-meta guided-explain-line">
        {EXPLAIN.limit[remote]} {ai.until === null ? EXPLAIN.limitBack : `${EXPLAIN.limitBackAtPrefix}${formatTime(ai.until)}.`}
      </p>
    );
  } else if (availability === "provider_unavailable") {
    body = (
      <p className="guided-meta guided-explain-line">
        {EXPLAIN.didNotAnswer[remote]}{" "}
        <button type="button" className="guided-text-button" onClick={() => void ai.probe(true)}>
          {EXPLAIN.tryAgain}
        </button>
      </p>
    );
  } else if (availability === "available" && chatBusy && ready === undefined) {
    body = <p className="guided-meta guided-explain-line">{EXPLAIN.busy}</p>;
  } else if (availability === "available") {
    body = (
      <>
        {text !== null && <ModelText text={text} caret={streaming} />}
        {streaming && (
          <p className="guided-meta" role={status}>
            {CHAT.writing}{" "}
            <button type="button" className="link-button" onClick={() => scan.stopExplain()}>
              {EXPLAIN.stop}
            </button>
          </p>
        )}
        {failed !== null && <p className="guided-meta">{EXPLAINER_FAILURE_LABELS[failed]}</p>}
        {ready !== undefined && !streaming && <p className="guided-meta guided-explain-badge">{EXPLAIN.badge[provider]}</p>}
      </>
    );
  } else {
    body = null;
  }

  return (
    <details className="guided-explain" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{EXPLAIN.open}</summary>
      {open && (
        <div className="guided-explain-body">
          {body}
          {availability === "available" && others.length > 0 && (
            <p className="guided-explain-others">
              {others.map((id) => (
                <button key={id} type="button" className="link-button" onClick={() => setTarget(id)} aria-pressed={target === id}>
                  {guidedFor(id).headline}
                </button>
              ))}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
