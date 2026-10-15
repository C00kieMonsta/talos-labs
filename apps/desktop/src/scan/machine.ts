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

export type ScanState =
  | { kind: "idle"; last: ScanReport | null }
  | { kind: "collecting"; startedAt: string; sections: Record<SectionKey, SectionProgressStatus> }
  | { kind: "evaluating"; state: SystemState }
  | { kind: "ready"; report: ScanReport; state: SystemState; explain: ExplainState; lastRecheck: LastRecheck | null }
  | { kind: "rechecking"; report: ScanReport; state: SystemState; key: SectionKey }
  | { kind: "failed"; error: ScanError; last: ScanReport | null };

export type ScanAction =
  | { type: "last_loaded"; report: ScanReport | null }
  | { type: "scan_started"; startedAt: string }
  | { type: "section_progress"; key: SectionKey; status: "started" | "ok" | "unavailable" }
  | { type: "collected"; state: SystemState }
  | { type: "collect_failed"; error: ScanError; last: ScanReport | null }
  | { type: "evaluated"; report: ScanReport }
  | { type: "recheck_started"; key: SectionKey }
  | { type: "recheck_done"; state: SystemState; report: ScanReport }
  | { type: "recheck_failed" }
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

    case "scan_started":
      if (state.kind === "idle" || state.kind === "ready" || state.kind === "failed") {
        return { kind: "collecting", startedAt: action.startedAt, sections: pendingSections() };
      }
      return state;

    case "section_progress":
      if (state.kind !== "collecting" || action.status === "started") return state;
      return { ...state, sections: { ...state.sections, [action.key]: action.status } };

    case "collected":
      return state.kind === "collecting" ? { kind: "evaluating", state: action.state } : state;

    case "collect_failed":
      return state.kind === "collecting" ? { kind: "failed", error: action.error, last: action.last } : state;

    case "evaluated":
      if (state.kind !== "evaluating") return state;
      return { kind: "ready", report: action.report, state: state.state, explain: { kind: "off" }, lastRecheck: null };

    case "recheck_started":
      if (state.kind !== "ready") return state;
      return { kind: "rechecking", report: state.report, state: state.state, key: action.key };

    case "recheck_done":
      if (state.kind !== "rechecking") return state;
      return {
        kind: "ready",
        report: action.report,
        state: action.state,
        explain: { kind: "off" },
        lastRecheck: { key: state.key, at: action.report.scannedAt },
      };

    case "recheck_failed":
      if (state.kind !== "rechecking") return state;
      return { kind: "ready", report: state.report, state: state.state, explain: { kind: "off" }, lastRecheck: null };

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
