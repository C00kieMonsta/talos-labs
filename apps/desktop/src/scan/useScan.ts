import { useCallback, useReducer, useRef, useState } from "react";
import type {
  Answer,
  ExplainerContext,
  ExplainerPort,
  ExplainerResult,
  Explanation,
  RuleId,
  ScanReport,
  SectionKey,
  SystemState,
  Turn,
} from "@talos/core";
import { clampHistory, clampQuestion } from "@talos/core";
import type { Adapters } from "../adapters";
import { initialScanState, lastReport, reduce, replaceSection } from "./machine";
import type { ScanError, ScanState } from "./machine";

/** The collector has its own 60 s budget; this guards against a hung invoke. */
export const SCAN_BUDGET_MS = 60_000;

export interface ScanDeps {
  readonly adapters: Pick<Adapters, "systemState" | "reports">;
  engine(state: SystemState): ScanReport;
  createExplainer(): Promise<ExplainerPort>;
  toContext(report: ScanReport): ExplainerContext;
}

export interface ScanController {
  readonly scan: ScanState;
  /** A short notice for things that failed without changing the report. */
  readonly notice: string | null;
  dismissNotice(): void;
  loadLast(): Promise<void>;
  start(): Promise<void>;
  cancel(): void;
  recheck(keys: readonly SectionKey[]): Promise<void>;
  explain(ruleId: RuleId): Promise<void>;
  prioritise(): Promise<void>;
  ask(question: string, history: readonly Turn[]): Promise<ExplainerResult<Answer>>;
}

const SCAN_ERRORS: readonly ScanError[] = ["cancelled", "timeout", "collector_crashed", "schema_mismatch"];

/** The Tauri adapter throws a ScanError with a kind; anything else falls back to message matching. */
function scanErrorKind(error: unknown): ScanError | null {
  if (typeof error !== "object" || error === null || !("kind" in error)) return null;
  const kind = (error as { kind: unknown }).kind;
  return typeof kind === "string" && (SCAN_ERRORS as readonly string[]).includes(kind) ? (kind as ScanError) : null;
}

export function classifyScanError(error: unknown, timedOut: boolean, aborted: boolean): ScanError {
  if (timedOut) return "timeout";
  if (aborted) return "cancelled";
  const kind = scanErrorKind(error);
  if (kind !== null) return kind;
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (text.includes("cancel")) return "cancelled";
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("schema") || text.includes("systemstate") || text.includes("invalid") || text.includes("expected")) {
    return "schema_mismatch";
  }
  return "collector_crashed";
}

interface ExplainCache {
  byRule: Record<string, Explanation>;
  order: RuleId[] | null;
}

export function useScan(deps: ScanDeps): ScanController {
  const [scan, dispatch] = useReducer(reduce, initialScanState);
  const scanRef = useRef<ScanState>(scan);
  scanRef.current = scan;
  const abortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<ExplainCache>({ byRule: {}, order: null });
  const [notice, setNotice] = useState<string | null>(null);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const loadLast = useCallback(async () => {
    try {
      const report = await deps.adapters.reports.loadLast();
      dispatch({ type: "last_loaded", report });
    } catch {
      dispatch({ type: "last_loaded", report: null });
    }
  }, [deps]);

  const start = useCallback(async () => {
    const current = scanRef.current;
    if (current.kind === "collecting" || current.kind === "evaluating" || current.kind === "rechecking") return;
    const last = lastReport(current);
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SCAN_BUDGET_MS);
    cacheRef.current = { byRule: {}, order: null };
    dispatch({ type: "scan_started", startedAt: new Date().toISOString() });
    try {
      const state = await deps.adapters.systemState.collect({
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: "section_progress", key: progress.key, status: progress.status }),
      });
      clearTimeout(timer);
      dispatch({ type: "collected", state });
      const report = deps.engine(state);
      dispatch({ type: "evaluated", report });
      try {
        await deps.adapters.reports.saveLast(report);
      } catch {
        setNotice("The report could not be saved for next time.");
      }
    } catch (error) {
      clearTimeout(timer);
      dispatch({ type: "collect_failed", error: classifyScanError(error, timedOut, controller.signal.aborted), last });
    } finally {
      abortRef.current = null;
    }
  }, [deps]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const recheck = useCallback(
    async (keys: readonly SectionKey[]) => {
      for (const key of keys) {
        const current = scanRef.current;
        if (current.kind !== "ready") return;
        cacheRef.current = { ...cacheRef.current, order: null };
        dispatch({ type: "recheck_started", key });
        try {
          const section = await deps.adapters.systemState.collectSection(key);
          const state = replaceSection(current.state, key, section);
          const report = deps.engine(state);
          dispatch({ type: "recheck_done", state, report });
          scanRef.current = { kind: "ready", report, state, explain: { kind: "off" }, lastRecheck: { key, at: report.scannedAt } };
          try {
            await deps.adapters.reports.saveLast(report);
          } catch {
            setNotice("The report could not be saved for next time.");
          }
        } catch {
          dispatch({ type: "recheck_failed" });
          setNotice("That section could not be read again. The earlier result still stands.");
          return;
        }
      }
    },
    [deps],
  );

  const explain = useCallback(
    async (ruleId: RuleId) => {
      const current = scanRef.current;
      if (current.kind !== "ready" || current.explain.kind === "running") return;
      const cached = cacheRef.current.byRule[ruleId];
      if (cached !== undefined) {
        dispatch({ type: "explain_ready", ...cacheRef.current });
        return;
      }
      dispatch({ type: "explain_started", target: ruleId });
      try {
        const explainer = await deps.createExplainer();
        const result = await explainer.explain({ context: deps.toContext(current.report), ruleId });
        if (scanRef.current.kind !== "ready" || scanRef.current.report !== current.report) return;
        if (result.ok) {
          cacheRef.current = {
            ...cacheRef.current,
            byRule: { ...cacheRef.current.byRule, [ruleId]: result.value },
          };
          dispatch({ type: "explain_ready", ...cacheRef.current });
        } else {
          dispatch({ type: "explain_failed", reason: result.reason, target: ruleId, ...cacheRef.current });
        }
      } catch {
        dispatch({ type: "explain_failed", reason: "unknown", target: ruleId, ...cacheRef.current });
      }
    },
    [deps],
  );

  const prioritise = useCallback(async () => {
    const current = scanRef.current;
    if (current.kind !== "ready" || current.explain.kind === "running") return;
    dispatch({ type: "explain_started", target: "prioritise" });
    try {
      const explainer = await deps.createExplainer();
      const result = await explainer.prioritise({ context: deps.toContext(current.report) });
      if (scanRef.current.kind !== "ready" || scanRef.current.report !== current.report) return;
      if (result.ok) {
        cacheRef.current = { ...cacheRef.current, order: [...result.value.order] };
        dispatch({ type: "explain_ready", ...cacheRef.current });
      } else {
        dispatch({ type: "explain_failed", reason: result.reason, target: "prioritise", ...cacheRef.current });
      }
    } catch {
      dispatch({ type: "explain_failed", reason: "unknown", target: "prioritise", ...cacheRef.current });
    }
  }, [deps]);

  const ask = useCallback(
    async (question: string, history: readonly Turn[]): Promise<ExplainerResult<Answer>> => {
      const report = lastReport(scanRef.current);
      if (report === null) return { ok: false, reason: "not_configured" };
      try {
        const explainer = await deps.createExplainer();
        return await explainer.ask({
          context: deps.toContext(report),
          history: clampHistory(history),
          question: clampQuestion(question),
        });
      } catch {
        return { ok: false, reason: "unknown" };
      }
    },
    [deps],
  );

  return { scan, notice, dismissNotice, loadLast, start, cancel, recheck, explain, prioritise, ask };
}
