import type { Category, RuleId, RuleStatus, Severity } from "../domain/finding";
import type { Os } from "../domain/system-state";
import type { AbortSignalLike } from "./system-state-port";

export type ExplainerId = "claude" | "ollama" | "none";

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

export type ExplainerFailure =
  | "not_configured"
  | "no_api_key"
  | "network"
  | "auth"
  | "timeout"
  | "rejected_output"
  | "refused"
  | "unknown";

export type ExplainerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: ExplainerFailure };

export interface ExplainerPort {
  readonly id: ExplainerId;
  explain(input: ExplainInput, signal?: AbortSignalLike): Promise<ExplainerResult<Explanation>>;
  prioritise(input: PrioritiseInput, signal?: AbortSignalLike): Promise<ExplainerResult<Prioritisation>>;
  ask(input: AskInput, signal?: AbortSignalLike): Promise<ExplainerResult<Answer>>;
}
