import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { AiAvailability, ExplainerFailure } from "@talos/core";
import { useApp } from "../app/context";
import type { ExplainState, ExplainTarget } from "../scan/machine";
import { REPROBE_MODEL_MS, REPROBE_SETTINGS_MS, limitReprobeMs } from "../scan/useAiAvailability";
import { CONNECT_POLL_MS, useConnect } from "../scan/ai-connect";
import { ICONS } from "../app/icons";
import { AI_ACTIONS, AI_OPEN_APPLE_SETTINGS, AI_UNAVAILABLE_COPY, EXPLAINER_FAILURE_LABELS, aiBadge, providerLines } from "../app/labels";
import type { AppleAiState } from "../app/labels";
import type { ExplainerProvider } from "../settings";
import { Icon } from "./Icon";

export type AiCardKind = "finding" | "overview";

export type AiCardState =
  | { kind: "probing" }
  | { kind: "available_idle" }
  | { kind: "streaming" }
  | { kind: "ready" }
  | { kind: "failed"; reason: ExplainerFailure }
  | { kind: "device_not_eligible" }
  | { kind: "apple_intelligence_not_enabled" }
  | { kind: "model_not_ready" }
  | { kind: "helper_unavailable" }
  | { kind: "not_connected" }
  | { kind: "connecting" }
  | { kind: "needs_sign_in" }
  | { kind: "limit_reached"; until: string | null }
  | { kind: "plan_not_eligible" }
  | { kind: "provider_unavailable" }
  | { kind: "not_offered" };

type AppleState = AppleAiState;
type ProviderState = "not_connected" | "connecting" | "needs_sign_in" | "limit_reached" | "plan_not_eligible" | "provider_unavailable" | "not_offered";

export { AI_UNAVAILABLE_COPY };

/** The card line for an unavailable state: the Apple strings as they were, the provider lines with its name filled in. */
export function aiUnavailableCopy(provider: ExplainerProvider, state: AppleState | ProviderState, until: string | null = null, kind: AiCardKind = "overview"): string {
  const lines = providerLines(provider);
  switch (state) {
    case "device_not_eligible":
    case "apple_intelligence_not_enabled":
    case "model_not_ready":
    case "helper_unavailable":
      return AI_UNAVAILABLE_COPY[state];
    case "not_connected":
      return kind === "overview" ? lines.notConnected : lines.notConnectedFinding;
    case "connecting":
      return lines.connecting;
    case "needs_sign_in":
      return lines.needsSignIn;
    case "limit_reached":
      return until === null ? lines.limitReached : lines.limitReachedAt(until);
    case "plan_not_eligible":
      return lines.planNotEligible;
    case "provider_unavailable":
      return lines.providerUnavailable;
    case "not_offered":
      return lines.notOffered;
  }
}

const START_LABELS: Readonly<Record<AiCardKind, string>> = {
  finding: "Explain this for me",
  overview: "Suggest an order",
};

/** Failures that mean the provider's state changed under the person; the card shows the state, not a generic error. */
const PROVIDER_REASONS: readonly ExplainerFailure[] = ["needs_sign_in", "limit_reached", "provider_unavailable"];

/**
 * The chrome around the model: availability first, then idle, streaming, ready or failed.
 * The unavailable states render for every user; there is no locked state, AI is free once connected.
 */
export function aiCardState(
  availability: AiAvailability | null,
  until: string | null,
  activity: "idle" | "streaming" | "ready" | { failed: ExplainerFailure },
): AiCardState {
  if (availability === null) return { kind: "probing" };
  if (availability === "limit_reached") return { kind: "limit_reached", until };
  if (availability !== "available" && availability !== "off") return { kind: availability };
  if (typeof activity === "object") {
    if (activity.failed === "limit_reached") return { kind: "limit_reached", until };
    if (activity.failed === "needs_sign_in" || activity.failed === "provider_unavailable") return { kind: activity.failed };
  }
  if (activity === "idle") return { kind: "available_idle" };
  if (activity === "streaming") return { kind: "streaming" };
  if (activity === "ready") return { kind: "ready" };
  return { kind: "failed", reason: activity.failed };
}

/** "Your X allowance is used up for now." and the clause with the time, so the time can sit in its own span. */
function limitParts(provider: ExplainerProvider, until: string): { head: string; tail: string } {
  const full = providerLines(provider).limitReachedAt(until);
  const cut = full.indexOf(". ");
  if (cut === -1) return { head: full, tail: "" };
  return { head: full.slice(0, cut + 2), tail: full.slice(cut + 2) };
}

export function AiCard({
  kind,
  state,
  provider,
  title,
  onStart,
  onStop,
  onRetry,
  onOpenAiSettings,
  onConnect,
  onCancelConnect,
  onSignInAgain,
  onChooseAnother,
  children,
}: {
  kind: AiCardKind;
  state: AiCardState;
  provider: ExplainerProvider;
  /** Visually hidden heading for the card region. */
  title?: string;
  onStart(): void;
  onStop(): void;
  onRetry(): void;
  onOpenAiSettings(): void;
  onConnect(): void;
  onCancelConnect(): void;
  onSignInAgain(): void;
  onChooseAnother(): void;
  /** The streaming or ready body. */
  children?: ReactNode;
}) {
  const heading = title ?? (kind === "overview" ? "Suggested order" : "AI explanation");
  const lines = providerLines(provider);
  const small = (label: string, onClick: () => void, icon?: keyof typeof ICONS) => (
    <button type="button" className="button button-small" onClick={onClick}>
      {icon !== undefined && <Icon icon={ICONS[icon]} />}
      {icon !== undefined ? " " : null}
      {label}
    </button>
  );
  const line = (): { icon: keyof typeof ICONS; spin?: boolean; text: ReactNode; textHidden?: boolean; caption?: boolean; live?: boolean; alert?: boolean; action?: ReactNode } => {
    switch (state.kind) {
      case "probing":
        return { icon: "spinner", spin: true, text: lines.probing };
      case "available_idle":
        return {
          icon: "ai",
          text: START_LABELS[kind],
          textHidden: true,
          action: (
            <button type="button" className="button" onClick={onStart}>
              {START_LABELS[kind]}
            </button>
          ),
        };
      case "streaming":
        return {
          icon: "ai",
          text: kind === "overview" ? "Thinking about the order" : "Writing",
          caption: true,
          action: small("Stop", onStop, "stop"),
        };
      case "ready":
        return { icon: "ai", text: heading, textHidden: true };
      case "failed":
        return { icon: "alert", text: EXPLAINER_FAILURE_LABELS[state.reason], alert: true, action: small(AI_ACTIONS.tryAgain, onRetry) };
      case "device_not_eligible":
        return { icon: "cpu", text: AI_UNAVAILABLE_COPY.device_not_eligible };
      case "apple_intelligence_not_enabled":
        return { icon: "ai", text: AI_UNAVAILABLE_COPY.apple_intelligence_not_enabled, action: small(AI_OPEN_APPLE_SETTINGS, onOpenAiSettings) };
      case "model_not_ready":
        return { icon: "download", text: AI_UNAVAILABLE_COPY.model_not_ready };
      case "helper_unavailable":
        return { icon: "alert", text: AI_UNAVAILABLE_COPY.helper_unavailable, action: small(AI_ACTIONS.tryAgain, onRetry) };
      case "not_connected":
        return { icon: "ai", text: kind === "overview" ? lines.notConnected : lines.notConnectedFinding, action: small(AI_ACTIONS.connect, onConnect) };
      case "connecting":
        return { icon: "spinner", spin: true, live: true, text: lines.connecting, action: small(AI_ACTIONS.cancel, onCancelConnect) };
      case "needs_sign_in":
        return { icon: "signIn", text: lines.needsSignIn, action: small(AI_ACTIONS.signInAgain, onSignInAgain, "signIn") };
      case "limit_reached": {
        if (state.until === null) return { icon: "clock", text: lines.limitReached };
        const { head, tail } = limitParts(provider, state.until);
        return {
          icon: "clock",
          text: (
            <>
              {head}
              <span className="ai-card-until">{tail}</span>
            </>
          ),
        };
      }
      case "plan_not_eligible":
        return { icon: "alert", text: lines.planNotEligible, action: small(AI_ACTIONS.chooseAnother, onChooseAnother) };
      case "provider_unavailable":
        return { icon: "alert", text: lines.providerUnavailable, action: small(AI_ACTIONS.tryAgain, onRetry) };
      case "not_offered":
        return { icon: "ai", text: lines.notOffered, action: small(AI_ACTIONS.chooseAnother, onChooseAnother) };
    }
  };
  const l = line();
  const body = state.kind === "ready" || (state.kind === "streaming" && kind !== "overview") ? children : null;
  const role = l.alert === true ? "alert" : l.caption === true || l.live === true ? "status" : undefined;
  return (
    <section className={`card ai-card ai-${state.kind}`} aria-label={heading} data-ai-state={state.kind}>
      <Icon icon={ICONS[l.icon]} size={20} className={l.spin === true ? "spin" : undefined} />
      {(l.textHidden !== true || l.action !== undefined) && (
        <div className="ai-card-head">
          <p className={l.textHidden === true ? "visually-hidden" : l.caption === true ? "muted" : undefined} role={role}>
            {l.text}
          </p>
          {l.action}
        </div>
      )}
      {body}
      {state.kind === "ready" && <p className="ai-card-foot">{aiBadge(provider)}</p>}
    </section>
  );
}

type AiCardHandlers = Pick<
  Parameters<typeof AiCard>[0],
  "onStart" | "onStop" | "onRetry" | "onOpenAiSettings" | "onConnect" | "onCancelConnect" | "onSignInAgain" | "onChooseAnother"
>;

export interface AiCardFlow {
  readonly state: AiCardState;
  readonly explain: ExplainState;
  readonly provider: ExplainerProvider;
  readonly handlers: AiCardHandlers;
}

/** Wires one AI card to the app: lazy probe on mount, re-probe schedules and the explain state for its target. */
export function useAiCardFlow(target: ExplainTarget): AiCardFlow {
  const { ai, scan, adapters, settings, router } = useApp();
  const connect = useConnect();
  const { availability, until, probe, reprobe } = ai;
  const provider = settings.explainer.provider;
  const enabled = settings.explainer.aiEnabled;
  useEffect(() => {
    if (enabled && availability === null) void probe();
  }, [enabled, availability, probe]);
  useEffect(() => {
    if (availability !== "model_not_ready") return;
    return reprobe(REPROBE_MODEL_MS);
  }, [availability, reprobe]);
  // A sign-in in progress, or one cancelled before the worker reported its end: re-read it until it settles (DESIGN-AI section 3).
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
  const explain: ExplainState = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.explain : { kind: "off" };
  const has = (cache: { byRule: Record<string, unknown>; order: unknown }) =>
    target === "prioritise" ? cache.order !== null : cache.byRule[target] !== undefined;
  const activity: "idle" | "streaming" | "ready" | { failed: ExplainerFailure } =
    explain.kind === "running" && explain.target === target
      ? "streaming"
      : explain.kind === "failed" && explain.target === target
        ? { failed: explain.reason }
        : (explain.kind === "ready" || explain.kind === "failed") && has(explain)
          ? "ready"
          : "idle";
  // A failure that reports a provider state change gets one cached probe so the availability catches up.
  const failedReason = explain.kind === "failed" && explain.target === target ? explain.reason : null;
  const probedFor = useRef<ExplainerFailure | null>(null);
  useEffect(() => {
    if (failedReason === null || !PROVIDER_REASONS.includes(failedReason)) {
      probedFor.current = null;
      return;
    }
    if (probedFor.current === failedReason) return;
    probedFor.current = failedReason;
    void probe();
  }, [failedReason, probe]);
  const start = () => {
    if (target === "prioritise") void scan.prioritise();
    else void scan.explain(target);
  };
  const state = aiCardState(availability, until, activity);
  return {
    state,
    explain,
    provider,
    handlers: {
      onStart: start,
      onStop: () => scan.stopExplain(),
      onRetry: () => {
        if (availability === "helper_unavailable" || availability === "provider_unavailable" || state.kind === "provider_unavailable") void probe(true);
        else start();
      },
      onOpenAiSettings: () => {
        void adapters.openSettingsPane("apple_intelligence");
        reprobe(REPROBE_SETTINGS_MS);
      },
      onConnect: () => connect.open(router.route),
      onCancelConnect: () => connect.cancel(),
      onSignInAgain: () => connect.signInAgain(router.route),
      onChooseAnother: () => connect.open(router.route),
    },
  };
}
