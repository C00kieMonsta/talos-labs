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
import { explainFrom, initialScanState, lastReport, reduce, replaceSection, survivingExplanations } from "./machine";
import type { ScanError, ScanState } from "./machine";

/** The collector has its own 60 s budget; this guards against a hung invoke. */
export const SCAN_BUDGET_MS = 60_000;

/** One turn of the Ask conversation, with what the answer pointed at. */
export interface AskMessage {
  readonly turn: Turn;
  readonly related?: readonly RuleId[];
  readonly outsideScope?: boolean;
}

export const RECHECK_FAILED_NOTICE = "That section could not be read again. The earlier result still stands.";
export const RECHECK_TIMEOUT_NOTICE = "That section took too long to read again. The earlier result still stands.";
/** Shown when a cancelled rescan returns to the report it interrupted. */
export const SCAN_CANCELLED_NOTICE = "You cancelled the check-up. Your earlier results are still here.";

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
  /** Clears a failed scan back to idle, keeping the last report. */
  dismissFailure(): void;
  loadLast(): Promise<void>;
  start(): Promise<void>;
  cancel(): void;
  recheck(keys: readonly SectionKey[]): Promise<void>;
  explain(ruleId: RuleId): Promise<void>;
  prioritise(): Promise<void>;
  ask(question: string, history: readonly Turn[]): Promise<ExplainerResult<Answer>>;
  /** The Ask conversation for the current report. Survives navigation; cleared when the report is replaced. */
  readonly conversation: readonly AskMessage[];
  setConversation(messages: readonly AskMessage[]): void;
  /** A question typed but not yet sent. */
  readonly draft: string;
  setDraft(draft: string): void;
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

class DeadlineError extends Error {}

/** Rejects with DeadlineError when `promise` has not settled within `ms`. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError("deadline")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function useScan(deps: ScanDeps): ScanController {
  const [scan, dispatch] = useReducer(reduce, initialScanState);
  const scanRef = useRef<ScanState>(scan);
  scanRef.current = scan;
  const abortRef = useRef<AbortController | null>(null);
  const recheckAbortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<ExplainCache>({ byRule: {}, order: null });
  // Bumped by every scan start; a recheck that began under an older value drops its result.
  const recheckGen = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversation, setConversation] = useState<readonly AskMessage[]>([]);
  const [draft, setDraft] = useState("");

  const dismissNotice = useCallback(() => setNotice(null), []);
  const dismissFailure = useCallback(() => dispatch({ type: "failure_dismissed" }), []);

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
    if (current.kind === "collecting" || current.kind === "evaluating") return;
    const last = lastReport(current);
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SCAN_BUDGET_MS);
    recheckGen.current += 1;
    recheckAbortRef.current?.abort();
    dispatch({ type: "scan_started", startedAt: new Date().toISOString() });
    try {
      const state = await deps.adapters.systemState.collect({
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: "section_progress", key: progress.key, status: progress.status }),
      });
      clearTimeout(timer);
      // Only a new state replaces the report, so a cancelled rescan keeps the explanations and the conversation.
      cacheRef.current = { byRule: {}, order: null };
      setConversation([]);
      setDraft("");
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
      const kind = classifyScanError(error, timedOut, controller.signal.aborted);
      dispatch({ type: "collect_failed", error: kind, last });
      // The machine goes back to the interrupted report; the banner for a failed scan does not show, so say it here.
      if (kind === "cancelled" && (current.kind === "ready" || current.kind === "rechecking")) setNotice(SCAN_CANCELLED_NOTICE);
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
        const gen = recheckGen.current;
        const controller = new AbortController();
        recheckAbortRef.current = controller;
        dispatch({ type: "recheck_started", key });
        try {
          // The deadline hands control back if the collector hangs; the signal tells it to stop.
          const section = await withDeadline(
            deps.adapters.systemState.collectSection(key, { signal: controller.signal }),
            SCAN_BUDGET_MS,
          );
          if (recheckGen.current !== gen) return;
          const state = replaceSection(current.state, key, section);
          const report = deps.engine(state);
          // The order was made for the old report; explanations that do not depend on this section still hold.
          const byRule = survivingExplanations(cacheRef.current.byRule, report, key);
          cacheRef.current = { byRule, order: null };
          dispatch({ type: "recheck_done", state, report, byRule });
          scanRef.current = { kind: "ready", report, state, explain: explainFrom(byRule, null), lastRecheck: { key, at: report.scannedAt } };
          try {
            await deps.adapters.reports.saveLast(report);
          } catch {
            setNotice("The report could not be saved for next time.");
          }
        } catch (error) {
          if (error instanceof DeadlineError) controller.abort();
          if (recheckGen.current !== gen) return;
          dispatch({ type: "recheck_failed", ...cacheRef.current });
          setNotice(error instanceof DeadlineError ? RECHECK_TIMEOUT_NOTICE : RECHECK_FAILED_NOTICE);
          return;
        } finally {
          if (recheckAbortRef.current === controller) recheckAbortRef.current = null;
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

  return {
    scan,
    notice,
    dismissNotice,
    dismissFailure,
    loadLast,
    start,
    cancel,
    recheck,
    explain,
    prioritise,
    ask,
    conversation,
    setConversation,
    draft,
    setDraft,
  };
}
