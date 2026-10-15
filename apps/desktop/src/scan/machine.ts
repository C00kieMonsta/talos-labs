import type {
  Explanation,
  ExplainerFailure,
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

/** A failure keeps the explanations and order already shown, and names the target that failed. */
export type ExplainState =
  | { kind: "off" }
  | { kind: "running"; target: ExplainTarget }
  | { kind: "ready"; byRule: Record<string, Explanation>; order: RuleId[] | null }
  | { kind: "failed"; reason: ExplainerFailure; target: ExplainTarget; byRule: Record<string, Explanation>; order: RuleId[] | null };

/** The last single-section recheck that produced the held report. */
export interface LastRecheck {
  readonly key: SectionKey;
  /** ISO 8601. The report's scannedAt. */
  readonly at: string;
}

export interface ReadyState {
  readonly kind: "ready";
  readonly report: ScanReport;
  readonly state: SystemState;
  readonly explain: ExplainState;
  readonly lastRecheck: LastRecheck | null;
}

export type ScanState =
  | { kind: "idle"; last: ScanReport | null }
  /** `previous` is the ready state a rescan interrupted; a cancelled rescan goes back to it. */
  | { kind: "collecting"; startedAt: string; sections: Record<SectionKey, SectionProgressStatus>; previous: ReadyState | null }
  | { kind: "evaluating"; state: SystemState }
  | ReadyState
  | { kind: "rechecking"; report: ScanReport; state: SystemState; key: SectionKey; explain: ExplainState }
  | { kind: "failed"; error: ScanError; last: ScanReport | null };

export type ScanAction =
  | { type: "last_loaded"; report: ScanReport | null }
  | { type: "scan_started"; startedAt: string }
  | { type: "section_progress"; key: SectionKey; status: "started" | "ok" | "unavailable" }
  | { type: "collected"; state: SystemState }
  | { type: "collect_failed"; error: ScanError; last: ScanReport | null }
  | { type: "failure_dismissed" }
  | { type: "evaluated"; report: ScanReport }
  | { type: "recheck_started"; key: SectionKey }
  /** `byRule` holds the explanations that survive the new report; the order is always stale. */
  | { type: "recheck_done"; state: SystemState; report: ScanReport; byRule: Record<string, Explanation> }
  /** The report is unchanged, so everything cached is handed back. */
  | { type: "recheck_failed"; byRule: Record<string, Explanation>; order: RuleId[] | null }
  | { type: "explain_started"; target: ExplainTarget }
  | { type: "explain_ready"; byRule: Record<string, Explanation>; order: RuleId[] | null }
  | { type: "explain_failed"; reason: ExplainerFailure; target: ExplainTarget; byRule: Record<string, Explanation>; order: RuleId[] | null };

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
      return null;
  }
}

/** The held SystemState, available only after a live scan. */
export function heldState(state: ScanState): SystemState | null {
  return state.kind === "ready" || state.kind === "rechecking" ? state.state : null;
}

/** Ready when anything is cached, otherwise off. */
export function explainFrom(byRule: Record<string, Explanation>, order: RuleId[] | null): ExplainState {
  return Object.keys(byRule).length > 0 || order !== null ? { kind: "ready", byRule, order } : { kind: "off" };
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
  return explain.kind === "running" ? { kind: "off" } : explain;
}

export function replaceSection<K extends SectionKey>(
  state: SystemState,
  key: K,
  section: SystemStateSections[K],
): SystemState {
  const sections = { ...state.sections, [key]: section } as SystemStateSections;
  return { ...state, sections };
}

export function reduce(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
    case "last_loaded":
      return state.kind === "idle" ? { kind: "idle", last: action.report } : state;

    case "scan_started": {
      if (state.kind === "collecting" || state.kind === "evaluating") return state;
      // A rescan may interrupt a recheck; the hook drops the recheck's late result.
      const previous: ReadyState | null =
        state.kind === "ready"
          ? { ...state, explain: settled(state.explain) }
          : state.kind === "rechecking"
            ? { kind: "ready", report: state.report, state: state.state, explain: settled(state.explain), lastRecheck: null }
            : null;
      return { kind: "collecting", startedAt: action.startedAt, sections: pendingSections(), previous };
    }

    case "section_progress":
      if (state.kind !== "collecting" || action.status === "started") return state;
      return { ...state, sections: { ...state.sections, [action.key]: action.status } };

    case "collected":
      return state.kind === "collecting" ? { kind: "evaluating", state: action.state } : state;

    case "collect_failed":
      if (state.kind !== "collecting") return state;
      // The user stopped a rescan; the report it interrupted is still good, so go back to it.
      if (action.error === "cancelled" && state.previous !== null) return state.previous;
      return { kind: "failed", error: action.error, last: action.last };

    case "failure_dismissed":
      return state.kind === "failed" ? { kind: "idle", last: state.last } : state;

    case "evaluated":
      if (state.kind !== "evaluating") return state;
      return { kind: "ready", report: action.report, state: state.state, explain: { kind: "off" }, lastRecheck: null };

    case "recheck_started":
      if (state.kind !== "ready") return state;
      return { kind: "rechecking", report: state.report, state: state.state, key: action.key, explain: settled(state.explain) };

    case "recheck_done":
      if (state.kind !== "rechecking") return state;
      return {
        kind: "ready",
        report: action.report,
        state: action.state,
        explain: explainFrom(action.byRule, null),
        lastRecheck: { key: state.key, at: action.report.scannedAt },
      };

    case "recheck_failed":
      if (state.kind !== "rechecking") return state;
      return { kind: "ready", report: state.report, state: state.state, explain: explainFrom(action.byRule, action.order), lastRecheck: null };

    case "explain_started":
      if (state.kind !== "ready") return state;
      return { ...state, explain: { kind: "running", target: action.target } };

    case "explain_ready":
      if (state.kind !== "ready") return state;
      return { ...state, explain: { kind: "ready", byRule: action.byRule, order: action.order } };

    case "explain_failed":
      if (state.kind !== "ready") return state;
      return {
        ...state,
        explain: { kind: "failed", reason: action.reason, target: action.target, byRule: action.byRule, order: action.order },
      };
  }
}
