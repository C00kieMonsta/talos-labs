import type {
  BatchOutcome,
  BatchPlan,
  Explanation,
  ExplainerFailure,
  FixError,
  FixPlan,
  Prioritisation,
  RuleId,
  ScanReport,
  SectionKey,
  SystemState,
  SystemStateSections,
} from "@talos/core";
import { SECTION_KEYS } from "@talos/core";

export type SectionProgressStatus = "pending" | "ok" | "unavailable";

export type ScanError = "collector_crashed" | "timeout" | "schema_mismatch" | "cancelled";

export type ExplainTarget = RuleId | "prioritise";

/** What the explainer has produced for this report. */
export interface ExplainCache {
  readonly byRule: Record<string, Explanation>;
  /** The suggested order: the model's order first, then the omitted findings in points order. */
  readonly order: RuleId[] | null;
  /** The model's own answer, for "Start with" and its reasons. */
  readonly priority: Prioritisation | null;
}

/** A failure keeps the explanations and order already shown, and names the target that failed. */
export type ExplainState =
  | { kind: "off" }
  | {
      kind: "running";
      target: ExplainTarget;
      partial: Partial<Explanation> | null;
      /** What was shown before, handed back on a cancel. */
      from: ExplainCache;
    }
  | ({ kind: "ready" } & ExplainCache)
  | ({ kind: "failed"; reason: ExplainerFailure; target: ExplainTarget } & ExplainCache);

/** The last single-section recheck that produced the held report. */
export interface LastRecheck {
  readonly key: SectionKey;
  /** ISO 8601. The report's scannedAt. */
  readonly at: string;
}

export type FixingPhase = "confirm" | "waiting_for_password" | "running" | "rechecking" | "done" | "failed";

export type RecheckResult = "pass" | "still_failing" | "unreadable";

/** The v0.2 shape plus the tag; what the expert sheet draws. */
export interface SingleFixingState {
  readonly kind: "single";
  readonly plan: FixPlan;
  readonly phase: FixingPhase;
  readonly step: number;
  readonly of: number;
  readonly error: FixError | null;
  /** After the automatic recheck. */
  readonly result: RecheckResult | null;
}

/** A fix-all batch; only the guided batch step draws it. */
export interface BatchFixingState {
  readonly kind: "batch";
  readonly plan: BatchPlan;
  readonly phase: FixingPhase;
  readonly step: number;
  readonly of: number;
  /** The user-level item being run, 0-based as Rust emits it; null during the password dialog. */
  readonly item: number | null;
  readonly error: FixError | null;
  readonly outcome: BatchOutcome | null;
  /** The recheck verdict per rule id, after the batch ran. */
  readonly byRule: Readonly<Record<string, RecheckResult>>;
}

export type FixingState = SingleFixingState | BatchFixingState;

export interface WatchingState {
  readonly ruleId: RuleId;
  readonly sections: readonly SectionKey[];
  readonly everyMs: number;
  /** ISO 8601. */
  readonly startedAt: string;
  readonly lastPollAt: string | null;
  readonly passedAt: string | null;
}

export interface ReadyState {
  readonly kind: "ready";
  readonly report: ScanReport;
  readonly state: SystemState;
  readonly explain: ExplainState;
  readonly lastRecheck: LastRecheck | null;
  readonly fixing: FixingState | null;
  readonly watching: WatchingState | null;
}

export interface PresentingState {
  readonly kind: "presenting";
  readonly report: ScanReport;
  readonly state: SystemState;
  /** Rows revealed so far, in SECTION_KEYS order. */
  readonly revealed: number;
  readonly phase: "areas" | "preparing";
  readonly previous: ReadyState | null;
}

export type ScanState =
  | { kind: "idle"; last: ScanReport | null }
  /** `previous` is the ready state a rescan interrupted; a cancelled rescan goes back to it. */
  | { kind: "collecting"; startedAt: string; sections: Record<SectionKey, SectionProgressStatus>; previous: ReadyState | null }
  | { kind: "evaluating"; state: SystemState; previous: ReadyState | null }
  | PresentingState
  | ReadyState
  | { kind: "rechecking"; report: ScanReport; state: SystemState; key: SectionKey; explain: ExplainState; watching: WatchingState | null }
  | { kind: "failed"; error: ScanError; last: ScanReport | null };

export type ScanAction =
  | { type: "last_loaded"; report: ScanReport | null }
  | { type: "scan_started"; startedAt: string }
  | { type: "section_progress"; key: SectionKey; status: "started" | "ok" | "unavailable" }
  | { type: "collected"; state: SystemState }
  | { type: "collect_failed"; error: ScanError; last: ScanReport | null }
  | { type: "failure_dismissed" }
  | { type: "evaluated"; report: ScanReport }
  | { type: "row_revealed" }
  | { type: "preparing" }
  | { type: "presented" }
  | { type: "presentation_cancelled" }
  | { type: "recheck_started"; key: SectionKey }
  /** `byRule` holds the explanations that survive the new report; the order is always stale. */
  | { type: "recheck_done"; state: SystemState; report: ScanReport; byRule: Record<string, Explanation> }
  /** The report is unchanged, so everything cached is handed back. */
  | { type: "recheck_failed"; byRule: Record<string, Explanation>; order: RuleId[] | null; priority?: Prioritisation | null }
  | { type: "explain_started"; target: ExplainTarget }
  | { type: "explain_partial"; target: ExplainTarget; partial: Partial<Explanation> | null }
  | { type: "explain_cancelled" }
  | { type: "explain_ready"; byRule: Record<string, Explanation>; order: RuleId[] | null; priority?: Prioritisation | null }
  | {
      type: "explain_failed";
      reason: ExplainerFailure;
      target: ExplainTarget;
      byRule: Record<string, Explanation>;
      order: RuleId[] | null;
      priority?: Prioritisation | null;
    }
  | { type: "fix_previewed"; plan: FixPlan }
  /** The preview itself was refused, so the sheet opens straight on the error. */
  | { type: "fix_preview_failed"; ruleId: RuleId; error: FixError }
  /** `item` lands on the batch variant and is ignored on the single one. */
  | { type: "fix_progress"; phase: "waiting_for_password" | "running"; step: number; of: number; item?: number }
  | { type: "fix_rechecking"; outcome?: BatchOutcome }
  | { type: "fix_done"; state: SystemState; report: ScanReport; result: RecheckResult; byRule: Record<string, Explanation> }
  | { type: "fix_failed"; error: FixError; step: number | null }
  | { type: "fix_dismissed" }
  | { type: "batch_previewed"; plan: BatchPlan }
  /** `verdicts` holds one recheck result per plan item; `byRule` the surviving explanations. */
  | {
      type: "batch_done";
      state: SystemState;
      report: ScanReport;
      outcome: BatchOutcome;
      byRule: Record<string, Explanation>;
      verdicts: Readonly<Record<string, RecheckResult>>;
    }
  | { type: "watch_started"; ruleId: RuleId; sections: readonly SectionKey[]; everyMs: number; startedAt: string }
  | { type: "watch_tick"; state: SystemState; report: ScanReport; at: string; byRule: Record<string, Explanation> }
  | { type: "watch_passed"; at: string }
  | { type: "watch_stopped" };

export const initialScanState: ScanState = { kind: "idle", last: null };

export function pendingSections(): Record<SectionKey, SectionProgressStatus> {
  const sections = {} as Record<SectionKey, SectionProgressStatus>;
  for (const key of SECTION_KEYS) sections[key] = "pending";
  return sections;
}

/** The most recent report the state holds, if any. */
export function lastReport(state: ScanState): ScanReport | null {
  switch (state.kind) {
    case "idle":
    case "failed":
      return state.last;
    case "ready":
    case "rechecking":
      return state.report;
    case "collecting":
    case "evaluating":
    case "presenting":
      return null;
  }
}

/** The held SystemState, available only after a live scan. */
export function heldState(state: ScanState): SystemState | null {
  return state.kind === "ready" || state.kind === "rechecking" ? state.state : null;
}

/** Ready when anything is cached, otherwise off. */
export function explainFrom(
  byRule: Record<string, Explanation>,
  order: RuleId[] | null,
  priority: Prioritisation | null = null,
): ExplainState {
  return Object.keys(byRule).length > 0 || order !== null ? { kind: "ready", byRule, order, priority } : { kind: "off" };
}

/** What the explain state holds, whatever its kind. */
export function explainCache(explain: ExplainState): ExplainCache {
  switch (explain.kind) {
    case "off":
      return { byRule: {}, order: null, priority: null };
    case "running":
      return explain.from;
    case "ready":
    case "failed":
      return { byRule: explain.byRule, order: explain.order, priority: explain.priority };
  }
}

/** Explanations still worth showing after `key` was re-read: the finding is still in the report and does not depend on that section. */
export function survivingExplanations(
  byRule: Record<string, Explanation>,
  report: ScanReport,
  key: SectionKey,
): Record<string, Explanation> {
  const kept: Record<string, Explanation> = {};
  for (const [ruleId, explanation] of Object.entries(byRule)) {
    const finding = report.findings.find((f) => f.ruleId === ruleId);
    if (finding !== undefined && !finding.requires.includes(key)) kept[ruleId] = explanation;
  }
  return kept;
}

/** A running explanation never lands once the scan moves on, so it is dropped before the state is kept. */
function settled(explain: ExplainState): ExplainState {
  return explain.kind === "running" ? explainFrom(explain.from.byRule, explain.from.order, explain.from.priority) : explain;
}

export function replaceSection<K extends SectionKey>(
  state: SystemState,
  key: K,
  section: SystemStateSections[K],
): SystemState {
  const sections = { ...state.sections, [key]: section } as SystemStateSections;
  return { ...state, sections };
}

/** True when the rule is no longer in the report, which only lists fail, review and unknown. */
export function rulePasses(report: ScanReport, ruleId: RuleId): boolean {
  const finding = report.findings.find((f) => f.ruleId === ruleId);
  return finding === undefined;
}

/** Stands in for a plan the engine refused to build. */
export function emptyPlan(ruleId: RuleId): FixPlan {
  return { planId: "", ruleId, lines: [], needsPassword: false, needsPassphrase: false, recheck: [], reversible: null, previous: null, expiresAt: "" };
}

function freshReady(report: ScanReport, state: SystemState): ReadyState {
  return { kind: "ready", report, state, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null };
}

function reduceScan(state: ScanState, action: ScanAction): ScanState | null {
  switch (action.type) {
    case "last_loaded":
      return state.kind === "idle" ? { kind: "idle", last: action.report } : state;

    case "scan_started": {
      if (state.kind === "collecting" || state.kind === "evaluating" || state.kind === "presenting") return state;
      // A rescan may interrupt a recheck; the hook drops the recheck's late result. It also clears any fix or watch.
      const previous: ReadyState | null =
        state.kind === "ready"
          ? { ...state, explain: settled(state.explain), fixing: null, watching: null }
          : state.kind === "rechecking"
            ? { ...freshReady(state.report, state.state), explain: settled(state.explain) }
            : null;
      return { kind: "collecting", startedAt: action.startedAt, sections: pendingSections(), previous };
    }

    case "section_progress":
      if (state.kind !== "collecting" || action.status === "started") return state;
      return { ...state, sections: { ...state.sections, [action.key]: action.status } };

    case "collected":
      return state.kind === "collecting" ? { kind: "evaluating", state: action.state, previous: state.previous } : state;

    case "collect_failed":
      if (state.kind !== "collecting") return state;
      // The user stopped a rescan; the report it interrupted is still good, so go back to it.
      if (action.error === "cancelled" && state.previous !== null) return state.previous;
      return { kind: "failed", error: action.error, last: action.last };

    case "failure_dismissed":
      return state.kind === "failed" ? { kind: "idle", last: state.last } : state;

    case "evaluated":
      if (state.kind !== "evaluating") return state;
      return { kind: "presenting", report: action.report, state: state.state, revealed: 0, phase: "areas", previous: state.previous };

    case "row_revealed":
      if (state.kind !== "presenting") return state;
      return { ...state, revealed: Math.min(SECTION_KEYS.length, state.revealed + 1) };

    case "preparing":
      return state.kind === "presenting" ? { ...state, phase: "preparing", revealed: SECTION_KEYS.length } : state;

    case "presented":
      return state.kind === "presenting" ? freshReady(state.report, state.state) : state;

    case "presentation_cancelled":
      if (state.kind !== "presenting") return state;
      return state.previous ?? { kind: "idle", last: null };

    case "recheck_started":
      if (state.kind !== "ready") return state;
      return { kind: "rechecking", report: state.report, state: state.state, key: action.key, explain: settled(state.explain), watching: state.watching };

    case "recheck_done":
      if (state.kind !== "rechecking") return state;
      return {
        ...freshReady(action.report, action.state),
        explain: explainFrom(action.byRule, null),
        lastRecheck: { key: state.key, at: action.report.scannedAt },
        watching: state.watching,
      };

    case "recheck_failed":
      if (state.kind !== "rechecking") return state;
      return { ...freshReady(state.report, state.state), explain: explainFrom(action.byRule, action.order, action.priority ?? null), watching: state.watching };

    default:
      return null;
  }
}

function reduceExplain(state: ReadyState, action: ScanAction): ReadyState | null {
  const explain = state.explain;
  switch (action.type) {
    case "explain_started":
      return { ...state, explain: { kind: "running", target: action.target, partial: null, from: explainCache(explain) } };

    case "explain_partial":
      if (explain.kind !== "running" || explain.target !== action.target) return state;
      return { ...state, explain: { ...explain, partial: action.partial } };

    case "explain_cancelled":
      if (explain.kind !== "running") return state;
      return { ...state, explain: explainFrom(explain.from.byRule, explain.from.order, explain.from.priority) };

    case "explain_ready":
      return { ...state, explain: { kind: "ready", byRule: action.byRule, order: action.order, priority: action.priority ?? null } };

    case "explain_failed":
      return {
        ...state,
        explain: {
          kind: "failed",
          reason: action.reason,
          target: action.target,
          byRule: action.byRule,
          order: action.order,
          priority: action.priority ?? null,
        },
      };

    default:
      return null;
  }
}

function reduceFix(state: ReadyState, action: ScanAction): ReadyState | null {
  const fixing = state.fixing;
  switch (action.type) {
    case "fix_previewed":
      return { ...state, fixing: { kind: "single", plan: action.plan, phase: "confirm", step: 0, of: action.plan.lines.length, error: null, result: null } };

    case "fix_preview_failed":
      return { ...state, fixing: { kind: "single", plan: emptyPlan(action.ruleId), phase: "failed", step: 0, of: 0, error: action.error, result: null } };

    case "batch_previewed": {
      const of = action.plan.items.reduce((sum, item) => sum + item.lines.length, 0);
      return { ...state, fixing: { kind: "batch", plan: action.plan, phase: "confirm", step: 0, of, item: null, error: null, outcome: null, byRule: {} } };
    }

    case "fix_progress":
      if (fixing === null) return state;
      if (fixing.kind === "batch") {
        return { ...state, fixing: { ...fixing, phase: action.phase, step: action.step, of: action.of, item: action.item ?? fixing.item } };
      }
      return { ...state, fixing: { ...fixing, phase: action.phase, step: action.step, of: action.of } };

    case "fix_rechecking":
      if (fixing === null) return state;
      if (fixing.kind === "batch") return { ...state, fixing: { ...fixing, phase: "rechecking", outcome: action.outcome ?? fixing.outcome } };
      return { ...state, fixing: { ...fixing, phase: "rechecking" } };

    case "fix_done":
      if (fixing === null || fixing.kind !== "single") return state;
      return {
        ...state,
        report: action.report,
        state: action.state,
        explain: explainFrom(action.byRule, null),
        fixing: { ...fixing, phase: "done", result: action.result, error: null },
      };

    case "batch_done":
      if (fixing === null || fixing.kind !== "batch") return state;
      return {
        ...state,
        report: action.report,
        state: action.state,
        explain: explainFrom(action.byRule, null),
        fixing: {
          ...fixing,
          phase: action.outcome.ok ? "done" : "failed",
          error: action.outcome.error,
          outcome: action.outcome,
          byRule: action.verdicts,
        },
      };

    case "fix_failed":
      if (fixing === null) return state;
      return { ...state, fixing: { ...fixing, phase: "failed", error: action.error, step: action.step ?? fixing.step } };

    case "fix_dismissed":
      return { ...state, fixing: null };

    case "watch_started":
      return {
        ...state,
        watching: {
          ruleId: action.ruleId,
          sections: action.sections,
          everyMs: action.everyMs,
          startedAt: action.startedAt,
          lastPollAt: null,
          passedAt: null,
        },
      };

    case "watch_tick":
      if (state.watching === null) return state;
      return {
        ...state,
        report: action.report,
        state: action.state,
        explain: explainFrom(action.byRule, null),
        watching: { ...state.watching, lastPollAt: action.at },
      };

    case "watch_passed":
      return state.watching === null ? state : { ...state, watching: { ...state.watching, passedAt: action.at } };

    case "watch_stopped":
      return { ...state, watching: null };

    default:
      return null;
  }
}

export function reduce(state: ScanState, action: ScanAction): ScanState {
  const scanned = reduceScan(state, action);
  if (scanned !== null) return scanned;
  if (state.kind !== "ready") return state;
  return reduceExplain(state, action) ?? reduceFix(state, action) ?? state;
}
