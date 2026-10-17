import type { Category, RuleId, RuleStatus, Severity } from "../domain/finding";
import type { Os } from "../domain/system-state";
import type { AbortSignalLike } from "./system-state-port";

/** chatgpt and claude_plan are the person's own subscriptions; claude is the Developer-mode API key. */
export type ExplainerId = "apple" | "chatgpt" | "claude_plan" | "claude" | "ollama" | "none";

/**
 * What the provider reports before a request. The four Apple states come from the
 * on-device helper; the seven provider states from ChatGPT and Claude; off means the
 * user switched AI off; a Developer-mode provider that is configured reports available.
 */
export type AiAvailability =
  | "available"
  | "device_not_eligible"
  | "apple_intelligence_not_enabled"
  | "model_not_ready"
  | "helper_unavailable"
  | "not_connected"
  | "connecting"
  | "needs_sign_in"
  | "limit_reached"
  | "plan_not_eligible"
  | "provider_unavailable"
  | "not_offered"
  | "off";

/** The states a ChatGPT or Claude provider can report; mirrored by the Rust ProviderState enum. */
export const PROVIDER_STATES: readonly AiAvailability[] = [
  "available",
  "not_connected",
  "connecting",
  "needs_sign_in",
  "limit_reached",
  "plan_not_eligible",
  "provider_unavailable",
  "not_offered",
];

/** States a re-probe schedule stops on: nothing will change by waiting. */
export const AI_TERMINAL_STATES: readonly AiAvailability[] = ["available", "device_not_eligible", "not_offered", "plan_not_eligible", "off"];

/** The state plus, for limit_reached, when the provider says the allowance comes back. */
export interface AiAvailabilityDetail {
  readonly state: AiAvailability;
  /** ISO, or null when the provider gave no time. */
  readonly until: string | null;
}

/** Onboarding radio buttons. Never free text. */
export interface ExplainerProfile {
  readonly role: "individual" | "freelancer" | "small_business";
  readonly technical: "low" | "medium" | "high";
  readonly handlesClientData: boolean;
  readonly laptopLeavesHome: boolean;
}

/**
 * key must match SAFE_STRING_PATTERN and be listed in the rule's evidenceKeys.
 * String values must match SAFE_STRING_PATTERN (enum or version).
 * toExplainerContext drops anything else.
 */
export interface SafeEvidence {
  readonly key: string;
  readonly value: boolean | number | string;
}

export const SAFE_STRING_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

export interface ExplainerFinding {
  readonly ruleId: RuleId;
  readonly status: "fail" | "review" | "unknown";
  readonly severity: Severity;
  readonly category: Category;
  readonly points: number;
  readonly evidence: readonly SafeEvidence[];
  /** True when the person chose to leave this check alone; the model never proposes it. */
  readonly accepted: boolean;
}

/**
 * The only document the model receives in the user message.
 * Catalog text lives in the system prompt. No field can hold a machine-originated string.
 */
export interface ExplainerContext {
  readonly schemaVersion: 1;
  readonly os: Os;
  /** Regex-validated. */
  readonly osVersion: string;
  readonly profile: ExplainerProfile;
  readonly score: number | null;
  readonly counts: Readonly<Record<RuleStatus, number>>;
  readonly findings: readonly ExplainerFinding[];
}

export const EXPLAINER_LIMITS = {
  maxFindings: 60,
  maxEvidencePerFinding: 8,
  maxQuestionChars: 2000,
  maxHistoryTurns: 10,
  maxOutputStringChars: 1200,
  maxOutputListItems: 10,
} as const;

export interface ExplainInput {
  readonly context: ExplainerContext;
  readonly ruleId: RuleId;
}

export interface PrioritiseInput {
  readonly context: ExplainerContext;
}

export interface Turn {
  readonly role: "user" | "assistant";
  /** Assistant turns are previously validated outputs, never raw model text. */
  readonly text: string;
}

export interface AskInput {
  readonly context: ExplainerContext;
  readonly history: readonly Turn[];
  readonly question: string;
}

/** The model explains. It never writes fix steps; those come from the catalog. */
export interface Explanation {
  readonly ruleId: RuleId;
  readonly whyItMattersForYou: string;
  readonly whatCouldHappen: string;
  readonly urgency: "today" | "this_week" | "when_convenient";
}

export interface Prioritisation {
  /** A permutation of the input finding ids. */
  readonly order: readonly RuleId[];
  readonly reasons: readonly { readonly ruleId: RuleId; readonly reason: string }[];
  readonly startWith: readonly RuleId[];
}

export interface Answer {
  readonly answer: string;
  readonly relatedRuleIds: readonly RuleId[];
  readonly outsideScope: boolean;
}

/**
 * unavailable: the model cannot answer right now; the UI re-probes availability.
 * too_long: the request did not fit the on-device window even without explanations.
 * cancelled: the request was stopped before it finished.
 * busy: another request is still running.
 * needs_sign_in, limit_reached, provider_unavailable: the provider's state changed mid-stream;
 * the adapter caches the matching availability so the UI can re-probe without a network call.
 */
export type ExplainerFailure =
  | "not_configured"
  | "no_api_key"
  | "network"
  | "auth"
  | "timeout"
  | "rejected_output"
  | "refused"
  | "unknown"
  | "unavailable"
  | "too_long"
  | "cancelled"
  | "busy"
  | "needs_sign_in"
  | "limit_reached"
  | "provider_unavailable";

export type ExplainerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ExplainerFailure };

export interface ExplainOptions<T> {
  readonly signal?: AbortSignalLike;
  /** Called with the whole value so far, never a delta. Non-streaming providers call it once. */
  readonly onPartial?: (partial: Partial<T>) => void;
}

export interface ExplainerPort {
  readonly id: ExplainerId;
  /** fresh bypasses the provider's cache. */
  availability(fresh?: boolean): Promise<AiAvailability>;
  /** Like availability, with the limit_reached time when the provider reports one. */
  availabilityDetail?(fresh?: boolean): Promise<AiAvailabilityDetail>;
  explain(input: ExplainInput, options?: ExplainOptions<Explanation>): Promise<ExplainerResult<Explanation>>;
  prioritise(input: PrioritiseInput, options?: ExplainOptions<Prioritisation>): Promise<ExplainerResult<Prioritisation>>;
  ask(input: AskInput, options?: ExplainOptions<Answer>): Promise<ExplainerResult<Answer>>;
}
