import { useEffect } from "react";
import type { ReactNode } from "react";
import type { AiAvailability, ExplainerFailure } from "@talos/core";
import { useApp } from "../app/context";
import type { ExplainState, ExplainTarget } from "../scan/machine";
import { REPROBE_MODEL_MS, REPROBE_SETTINGS_MS } from "../scan/useAiAvailability";
import { ICONS } from "../app/icons";
import { EXPLAINER_FAILURE_LABELS } from "../app/labels";
import { Icon } from "./Icon";
import { LicenceField } from "./LicenceField";

export const AI_BADGE = "Written on this Mac by Apple Intelligence. Not verified.";

export type AiCardKind = "finding" | "overview" | "ask";

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
  | { kind: "locked" };

export const AI_UNAVAILABLE_COPY: Readonly<Record<Exclude<AiAvailability, "available" | "off">, string>> = {
  device_not_eligible: "AI explanations need Apple Intelligence, which this Mac can't run. Everything else works without it.",
  apple_intelligence_not_enabled: "Turn on Apple Intelligence to get explanations written for you on this Mac.",
  model_not_ready: "Apple Intelligence is still downloading its model. This finishes on its own; keep the Mac on Wi-Fi and plugged in.",
  helper_unavailable: "AI explanations aren't available right now.",
};

export const AI_LOCKED_COPY = "AI explanations are part of the full version.";

const START_LABELS: Readonly<Record<AiCardKind, string>> = {
  finding: "Explain this for me",
  overview: "Suggest an order",
  ask: "Ask",
};

/**
 * The chrome around the model: availability before the lock, then idle, streaming, ready or failed.
 * The unavailable states render for every user; locked only when the model is available and AI is paid.
 */
export function aiCardState(
  availability: AiAvailability | null,
  locked: boolean,
  activity: "idle" | "streaming" | "ready" | { failed: ExplainerFailure },
): AiCardState {
  if (availability === null) return { kind: "probing" };
  if (availability !== "available" && availability !== "off") return { kind: availability };
  if (locked) return { kind: "locked" };
  if (activity === "idle") return { kind: "available_idle" };
  if (activity === "streaming") return { kind: "streaming" };
  if (activity === "ready") return { kind: "ready" };
  return { kind: "failed", reason: activity.failed };
}

export function AiCard({
  kind,
  state,
  title,
  onStart,
  onStop,
  onRetry,
  onOpenAiSettings,
  onBuy,
  onUnlocked,
  children,
}: {
  kind: AiCardKind;
  state: AiCardState;
  /** Visually hidden heading for the card region. */
  title?: string;
  onStart(): void;
  onStop(): void;
  onRetry(): void;
  onOpenAiSettings(): void;
  onBuy(): void;
  onUnlocked?(): void;
  /** The streaming or ready body. */
  children?: ReactNode;
}) {
  const heading = title ?? (kind === "overview" ? "Suggested order" : "AI explanation");
  const line = (): { icon: keyof typeof ICONS; spin?: boolean; text: string; textHidden?: boolean; caption?: boolean; alert?: boolean; action?: ReactNode } => {
    switch (state.kind) {
      case "probing":
        return { icon: "spinner", spin: true, text: "Checking whether Apple Intelligence is available" };
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
          action: (
            <button type="button" className="button button-small" onClick={onStop}>
              <Icon icon={ICONS.stop} /> Stop
            </button>
          ),
        };
      case "ready":
        return { icon: "ai", text: heading, textHidden: true };
      case "failed":
        return {
          icon: "alert",
          text: EXPLAINER_FAILURE_LABELS[state.reason],
          alert: true,
          action: (
            <button type="button" className="button button-small" onClick={onRetry}>
              Try again
            </button>
          ),
        };
      case "device_not_eligible":
        return { icon: "cpu", text: AI_UNAVAILABLE_COPY.device_not_eligible };
      case "apple_intelligence_not_enabled":
        return {
          icon: "ai",
          text: AI_UNAVAILABLE_COPY.apple_intelligence_not_enabled,
          action: (
            <button type="button" className="button button-small" onClick={onOpenAiSettings}>
              Open Apple Intelligence settings
            </button>
          ),
        };
      case "model_not_ready":
        return { icon: "download", text: AI_UNAVAILABLE_COPY.model_not_ready };
      case "helper_unavailable":
        return {
          icon: "alert",
          text: AI_UNAVAILABLE_COPY.helper_unavailable,
          action: (
            <button type="button" className="button button-small" onClick={onRetry}>
              Try again
            </button>
          ),
        };
      case "locked":
        return { icon: "lock", text: AI_LOCKED_COPY };
    }
  };
  const l = line();
  const body = state.kind === "ready" || (state.kind === "streaming" && kind !== "overview") ? children : null;
  return (
    <section className={`card ai-card ai-${state.kind}`} aria-label={heading} data-ai-state={state.kind}>
      <Icon icon={ICONS[l.icon]} size={20} className={l.spin === true ? "spin" : undefined} />
      {(l.textHidden !== true || l.action !== undefined) && (
        <div className="ai-card-head">
          <p className={l.textHidden === true ? "visually-hidden" : l.caption === true ? "muted" : undefined} role={l.alert === true ? "alert" : l.caption === true ? "status" : undefined}>
            {l.text}
          </p>
          {l.action}
        </div>
      )}
      {body}
      {state.kind === "ready" && <p className="ai-card-foot">{AI_BADGE}</p>}
      {state.kind === "locked" && (
        <div className="ai-card-extra">
          <LicenceField onBuy={onBuy} onUnlocked={onUnlocked} />
        </div>
      )}
    </section>
  );
}

export interface AiCardFlow {
  readonly state: AiCardState;
  readonly explain: ExplainState;
  readonly handlers: Pick<Parameters<typeof AiCard>[0], "onStart" | "onStop" | "onRetry" | "onOpenAiSettings" | "onBuy">;
}

/** Wires one AI card to the app: lazy probe on mount, re-probe schedules, lock and the explain state for its target. */
export function useAiCardFlow(target: ExplainTarget): AiCardFlow {
  const { ai, gate, scan, adapters, settings } = useApp();
  const { availability, probe, reprobe } = ai;
  const enabled = settings.explainer.aiEnabled;
  useEffect(() => {
    if (enabled && availability === null) void probe();
  }, [enabled, availability, probe]);
  useEffect(() => {
    if (availability !== "model_not_ready") return;
    return reprobe(REPROBE_MODEL_MS);
  }, [availability, reprobe]);
  const explain: ExplainState = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.explain : { kind: "off" };
  const has = (cache: { byRule: Record<string, unknown>; order: unknown }) =>
    target === "prioritise" ? cache.order !== null : target === "ask" ? false : cache.byRule[target] !== undefined;
  const activity: "idle" | "streaming" | "ready" | { failed: ExplainerFailure } =
    explain.kind === "running" && explain.target === target
      ? "streaming"
      : explain.kind === "failed" && explain.target === target
        ? { failed: explain.reason }
        : (explain.kind === "ready" || explain.kind === "failed") && has(explain)
          ? "ready"
          : "idle";
  const start = () => {
    if (target === "prioritise") void scan.prioritise();
    else if (target !== "ask") void scan.explain(target);
  };
  const state = aiCardState(availability, !gate.has("explainer"), activity);
  return {
    state,
    explain,
    handlers: {
      onStart: start,
      onStop: () => scan.stopExplain(),
      onRetry: () => {
        if (availability === "helper_unavailable") void probe(true);
        else start();
      },
      onOpenAiSettings: () => {
        void adapters.openSettingsPane("apple_intelligence");
        reprobe(REPROBE_SETTINGS_MS);
      },
      onBuy: () => void adapters.fixes.openBuyPage(),
    },
  };
}
