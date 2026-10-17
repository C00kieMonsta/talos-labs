import { useCallback, useReducer, useRef, useState } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  Answer,
  ExplainerContext,
  ExplainerPort,
  ExplainerResult,
  Explanation,
  FixChoice,
  Prioritisation,
  RuleId,
  ScanReport,
  SectionKey,
  SystemState,
} from "@talos/core";
import type { Adapters } from "../adapters";
import { initialScanState, lastReport, reduce, replaceSection, survivingExplanations } from "./machine";
import type { ExplainCache, ScanAction, ScanError, ScanState } from "./machine";
import { useFixActions } from "./useFix";
import type { WatchSpec } from "./useFix";

/** The collector has its own 60 s budget; this guards against a hung invoke. */
export const SCAN_BUDGET_MS = 60_000;

export const RECHECK_FAILED_NOTICE = "That section could not be read again. The earlier result still stands.";
export const RECHECK_TIMEOUT_NOTICE = "That section took too long to read again. The earlier result still stands.";
/** Shown when a cancelled rescan returns to the report it interrupted. */
export const SCAN_CANCELLED_NOTICE = "You cancelled the check-up. Your earlier results are still here.";
export const SAVE_FAILED_NOTICE = "The report could not be saved for next time.";

export interface ScanDeps {
  readonly adapters: Pick<Adapters, "systemState" | "reports" | "fixes">;
  engine(state: SystemState): ScanReport;
  createExplainer(): Promise<ExplainerPort>;
  toContext(report: ScanReport): ExplainerContext;
}

export interface FixActions {
  previewFix(ruleId: RuleId, choice: FixChoice): Promise<void>;
  applyFix(passphrase?: string): Promise<void>;
  /** A fix-all plan for the guided batch step; a refusal lands in a failed single sheet on the first id. */
  previewBatch(ruleIds: readonly RuleId[]): Promise<void>;
  /** Runs the previewed batch, rechecks its union of sections once, and records a verdict per item. */
  applyBatch(): Promise<void>;
  /** Aborts a running apply; in the confirm or a settled phase it closes the sheet. */
  cancelFix(): void;
  dismissFix(): void;
  /** With `watch`, the sections and interval come from the caller and an in_app rule is watched too. */
  startWatch(ruleId: RuleId, watch?: WatchSpec): void;
  stopWatch(): void;
  /** Finder reveal, then the watcher for that rule. */
  reveal(ruleId: RuleId, choice: FixChoice): Promise<void>;
}

export interface ScanController extends FixActions {
  readonly scan: ScanState;
  /** A short notice for things that failed without changing the report. */
  readonly notice: string | null;
  dismissNotice(): void;
  /** Clears a failed scan back to idle, keeping the last report. */
  dismissFailure(): void;
  loadLast(): Promise<void>;
  start(): Promise<void>;
  /** Stops the collect, or discards an unpresented report; either way the earlier results come back. */
  cancel(): void;
  /** Presentation steps the pacer drives. */
  revealRow(): void;
  markPreparing(): void;
  /** presenting -> ready; the explain cache resets here. */
  present(): Promise<void>;
  recheck(keys: readonly SectionKey[]): Promise<void>;
  explain(ruleId: RuleId): Promise<void>;
  prioritise(): Promise<void>;
  /** Stops the in-flight explain or prioritise. Never lands in failed. */
  stopExplain(): void;
}

/** What the fix and watch actions share with the scan hook. */
export interface ScanInternals {
  readonly deps: ScanDeps;
  readonly dispatch: Dispatch<ScanAction>;
  readonly scanRef: MutableRefObject<ScanState>;
  readonly cacheRef: MutableRefObject<ExplainCache>;
  /** Bumped by every scan start; a recheck that began under an older value drops its result. */
  readonly generation: MutableRefObject<number>;
  setNotice(text: string | null): void;
  saveLast(report: ScanReport): Promise<void>;
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

export class DeadlineError extends Error {}

/** Rejects with DeadlineError when `promise` has not settled within `ms`. */
export function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
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

const EMPTY_CACHE: ExplainCache = { byRule: {}, order: null, priority: null };

export function useScan(deps: ScanDeps): ScanController {
  const [scan, rawDispatch] = useReducer(reduce, initialScanState);
  const scanRef = useRef<ScanState>(scan);
  // The ref follows every dispatch at once, so a second call in the same tick sees the new state.
  const dispatch = useCallback((action: ScanAction) => {
    scanRef.current = reduce(scanRef.current, action);
    rawDispatch(action);
  }, []);
  const abortRef = useRef<AbortController | null>(null);
  const recheckAbortRef = useRef<AbortController | null>(null);
  const explainAbortRef = useRef<AbortController | null>(null);
  const cacheRef = useRef<ExplainCache>(EMPTY_CACHE);
  const generation = useRef(0);
  const [notice, setNotice] = useState<string | null>(null);

  const dismissNotice = useCallback(() => setNotice(null), []);
  const dismissFailure = useCallback(() => dispatch({ type: "failure_dismissed" }), [dispatch]);

  const saveLast = useCallback(
    async (report: ScanReport) => {
      try {
        await deps.adapters.reports.saveLast(report);
      } catch {
        setNotice(SAVE_FAILED_NOTICE);
      }
    },
    [deps],
  );

  const loadLast = useCallback(async () => {
    try {
      const report = await deps.adapters.reports.loadLast();
      dispatch({ type: "last_loaded", report });
    } catch {
      dispatch({ type: "last_loaded", report: null });
    }
  }, [deps, dispatch]);

  const start = useCallback(async () => {
    const current = scanRef.current;
    if (current.kind === "collecting" || current.kind === "evaluating" || current.kind === "presenting") return;
    const last = lastReport(current);
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, SCAN_BUDGET_MS);
    generation.current += 1;
    recheckAbortRef.current?.abort();
    explainAbortRef.current?.abort();
    dispatch({ type: "scan_started", startedAt: new Date().toISOString() });
    try {
      const state = await deps.adapters.systemState.collect({
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: "section_progress", key: progress.key, status: progress.status }),
      });
      clearTimeout(timer);
      dispatch({ type: "collected", state });
      // The pacer reveals the report row by row; nothing is saved or reset until it is presented.
      dispatch({ type: "evaluated", report: deps.engine(state) });
    } catch (error) {
      clearTimeout(timer);
      const kind = classifyScanError(error, timedOut, controller.signal.aborted);
      dispatch({ type: "collect_failed", error: kind, last });
      // The machine goes back to the interrupted report; the banner for a failed scan does not show, so say it here.
      if (kind === "cancelled" && (current.kind === "ready" || current.kind === "rechecking")) setNotice(SCAN_CANCELLED_NOTICE);
    } finally {
      abortRef.current = null;
    }
  }, [deps, dispatch]);

  const cancel = useCallback(() => {
    const current = scanRef.current;
    if (current.kind === "presenting") {
      dispatch({ type: "presentation_cancelled" });
      if (current.previous !== null) setNotice(SCAN_CANCELLED_NOTICE);
      return;
    }
    abortRef.current?.abort();
  }, [dispatch]);

  const revealRow = useCallback(() => dispatch({ type: "row_revealed" }), [dispatch]);
  const markPreparing = useCallback(() => dispatch({ type: "preparing" }), [dispatch]);

  const present = useCallback(async () => {
    const current = scanRef.current;
    if (current.kind !== "presenting") return;
    cacheRef.current = EMPTY_CACHE;
    dispatch({ type: "presented" });
    await saveLast(current.report);
  }, [saveLast, dispatch]);

  const recheck = useCallback(
    async (keys: readonly SectionKey[]) => {
      for (const key of keys) {
        const current = scanRef.current;
        if (current.kind !== "ready") return;
        const gen = generation.current;
        const controller = new AbortController();
        recheckAbortRef.current = controller;
        dispatch({ type: "recheck_started", key });
        try {
          // The deadline hands control back if the collector hangs; the signal tells it to stop.
          const section = await withDeadline(
            deps.adapters.systemState.collectSection(key, { signal: controller.signal }),
            SCAN_BUDGET_MS,
          );
          if (generation.current !== gen) return;
          const state = replaceSection(current.state, key, section);
          const report = deps.engine(state);
          // The order was made for the old report; explanations that do not depend on this section still hold.
          const byRule = survivingExplanations(cacheRef.current.byRule, report, key);
          cacheRef.current = { byRule, order: null, priority: null };
          dispatch({ type: "recheck_done", state, report, byRule });
          await saveLast(report);
        } catch (error) {
          if (error instanceof DeadlineError) controller.abort();
          if (generation.current !== gen) return;
          dispatch({ type: "recheck_failed", ...cacheRef.current });
          setNotice(error instanceof DeadlineError ? RECHECK_TIMEOUT_NOTICE : RECHECK_FAILED_NOTICE);
          return;
        } finally {
          if (recheckAbortRef.current === controller) recheckAbortRef.current = null;
        }
      }
    },
    [deps, saveLast, dispatch],
  );

  const stopExplain = useCallback(() => {
    explainAbortRef.current?.abort();
  }, []);

  /** Runs one explainer call against the held report and settles the explain state. */
  const runExplain = useCallback(
    async <T,>(
      target: RuleId | "prioritise" | "ask",
      call: (explainer: ExplainerPort, signal: AbortSignal, onPartial: (partial: Partial<T>) => void) => Promise<ExplainerResult<T>>,
      onValue: (value: T, report: ScanReport) => void,
    ): Promise<ExplainerResult<T>> => {
      const current = scanRef.current;
      if (current.kind !== "ready") {
        // A stored report with no live scan can still be asked about; nothing streams into the machine.
        if (lastReport(current) === null) return { ok: false, reason: "not_configured" };
        const controller = new AbortController();
        explainAbortRef.current = controller;
        try {
          return await call(await deps.createExplainer(), controller.signal, () => undefined);
        } catch {
          return { ok: false, reason: "unknown" };
        } finally {
          if (explainAbortRef.current === controller) explainAbortRef.current = null;
        }
      }
      if (current.explain.kind === "running") return { ok: false, reason: "busy" };
      const controller = new AbortController();
      explainAbortRef.current = controller;
      dispatch({ type: "explain_started", target });
      const onPartial = (partial: Partial<T>) => {
        if (controller.signal.aborted) return;
        if (target === "ask") {
          const answer = (partial as Partial<Answer>).answer;
          if (typeof answer === "string") dispatch({ type: "ask_partial", answerPartial: answer });
        } else {
          dispatch({ type: "explain_partial", target, partial: partial as Partial<Explanation> });
        }
      };
      let result: ExplainerResult<T>;
      try {
        result = await call(await deps.createExplainer(), controller.signal, onPartial);
      } catch {
        result = { ok: false, reason: "unknown" };
      } finally {
        if (explainAbortRef.current === controller) explainAbortRef.current = null;
      }
      const after = scanRef.current;
      if (after.kind !== "ready" || after.report !== current.report) return result;
      if (controller.signal.aborted) {
        dispatch({ type: "explain_cancelled" });
        return { ok: false, reason: "cancelled" };
      }
      if (result.ok) {
        onValue(result.value, current.report);
        dispatch(target === "ask" ? { type: "ask_done" } : { type: "explain_ready", ...cacheRef.current });
      } else {
        dispatch({ type: "explain_failed", reason: result.reason, target, ...cacheRef.current });
      }
      return result;
    },
    [deps, dispatch],
  );

  const explain = useCallback(
    async (ruleId: RuleId) => {
      const current = scanRef.current;
      if (current.kind !== "ready" || current.explain.kind === "running") return;
      if (cacheRef.current.byRule[ruleId] !== undefined) {
        dispatch({ type: "explain_ready", ...cacheRef.current });
        return;
      }
      await runExplain<Explanation>(
        ruleId,
        (explainer, signal, onPartial) => explainer.explain({ context: deps.toContext(current.report), ruleId }, { signal, onPartial }),
        (value) => {
          cacheRef.current = { ...cacheRef.current, byRule: { ...cacheRef.current.byRule, [ruleId]: value } };
        },
      );
    },
    [deps, runExplain, dispatch],
  );

  const prioritise = useCallback(async () => {
    const current = scanRef.current;
    if (current.kind !== "ready") return;
    await runExplain<Prioritisation>(
      "prioritise",
      (explainer, signal, onPartial) => explainer.prioritise({ context: deps.toContext(current.report) }, { signal, onPartial }),
      (value, report) => {
        // Findings the model did not see follow its order, in points order.
        const named = new Set<string>(value.order);
        const omitted = report.findings.filter((f) => f.status !== "unknown" && !named.has(f.ruleId)).map((f) => f.ruleId);
        cacheRef.current = { ...cacheRef.current, order: [...value.order, ...omitted], priority: value };
      },
    );
  }, [deps, runExplain]);

  const fixActions = useFixActions({ deps, dispatch, scanRef, cacheRef, generation, setNotice, saveLast });

  return {
    scan,
    notice,
    dismissNotice,
    dismissFailure,
    loadLast,
    start,
    cancel,
    revealRow,
    markPreparing,
    present,
    recheck,
    explain,
    prioritise,
    stopExplain,
    ...fixActions,
  };
}
