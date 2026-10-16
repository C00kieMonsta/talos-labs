import type { Category, Evidence, Fix, RuleId, Severity } from "./finding";
import type { Os, SectionKey, SystemState, UnavailableReason } from "./system-state";

export interface RuleContext {
  /**
   * ISO 8601. When the engine ran; becomes ScanReport.scannedAt.
   * Rules that measure age compare against state.collectedAt, not now,
   * so a recheck on a held SystemState gives the same answer.
   */
  readonly now: string;
  readonly os: Os;
}

/**
 * unknown.reason: a nested section's UnavailableReason (rule 028 forwards
 * BrowserReport.extensions.reason) or "indeterminate" when the data was
 * present but inconclusive. "rule_error" is set by the engine only.
 */
export type RuleOutcome =
  | { readonly status: "pass" | "fail" | "review"; readonly evidence: readonly Evidence[] }
  | {
      readonly status: "unknown";
      readonly reason: UnavailableReason | "indeterminate";
      readonly evidence: readonly Evidence[];
    }
  | { readonly status: "not_applicable"; readonly evidence: readonly Evidence[] };

/** Guided-flow copy. Reading age about 10; the catalog test enforces the caps and the banned-word list. */
export interface GuidedStrings {
  /** The problem, no trailing stop, at most 60 characters. */
  readonly headline: string;
  /** One sentence why it matters to this person, at most 110 characters, ends with a stop. */
  readonly why: string;
  /** Primary button for a fix-for-me step, at most 22 characters; "Show me where" for every deep_link rule; "Details" for rules with no pane (manual). */
  readonly verb: string;
  /** Shown with the tick. Starts with "Done." */
  readonly done: string;
  /** What to do on the opened page. Non-null exactly when fix.apply.kind is "deep_link". */
  readonly where: string | null;
}

export interface Rule {
  readonly id: RuleId;
  /** Reader-facing statement of what is checked, e.g. "Your disk is encrypted". */
  readonly title: string;
  /**
   * The problem stated plainly, used as the headline when the rule fails or needs review,
   * e.g. "Your disk is not encrypted". Same length class as title; no trailing full stop.
   */
  readonly failTitle: string;
  readonly severity: Severity;
  readonly category: Category;
  /** Benchmark section in the catalog's cisEdition, or null. */
  readonly cis: string | null;
  readonly os: readonly Os[];
  /** Sections that must be ok. The engine returns unknown before calling evaluate otherwise. */
  readonly requires: readonly SectionKey[];
  /**
   * Every evidence key this rule may emit. Each must match SAFE_STRING_PATTERN.
   * The explainer chokepoint drops evidence whose key is not listed here.
   */
  readonly evidenceKeys: readonly string[];
  /** Allowed values per evidence key for enum-kind evidence. Anything else is downgraded to text. */
  readonly evidenceVocabulary: Readonly<Record<string, readonly string[]>>;
  /** Authored plain-language "why it matters". */
  readonly explanation: string;
  readonly fix: Fix;
  readonly guided: GuidedStrings;
  evaluate(state: SystemState, ctx: RuleContext): RuleOutcome;
}

export interface RuleCatalog {
  /** Bumped whenever a rule's text, severity or condition changes. */
  readonly version: string;
  /** The benchmark edition every cis field refers to. */
  readonly cisEdition: string;
  readonly rules: readonly Rule[];
}
