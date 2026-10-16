import { useCallback, useEffect, useRef } from "react";
import type { BatchOutcome, Explanation, FixChoice, FixError, RuleId, ScanReport, SectionKey, SystemState } from "@talos/core";
import { awayPolling, type AwayPoller } from "./awayPolling";
import { replaceSection, rulePasses, survivingExplanations } from "./machine";
import type { RecheckResult } from "./machine";
import type { FixActions, ScanInternals } from "./useScan";
import { DeadlineError, SCAN_BUDGET_MS, withDeadline } from "./useScan";

/** Default interval for a watcher whose rule names none. */
export const WATCH_EVERY_MS = 3000;

/** What a guided show step watches, in place of the rule's own watch list. */
export interface WatchSpec {
  readonly sections: readonly SectionKey[];
  readonly everyMs: number;
}

const FIX_ERRORS: readonly FixError[] = [
  "cancelled",
  "wrong_password",
  "command_failed",
  "timeout",
  "plan_expired",
  "precondition_changed",
  "not_in_catalog",
  "invalid_choice",
  "invalid_input",
  "busy",
];

function asFixError(error: unknown): FixError {
  return typeof error === "string" && (FIX_ERRORS as readonly string[]).includes(error) ? (error as FixError) : "command_failed";
}

interface Reread {
  readonly state: SystemState;
  readonly report: ScanReport;
  readonly byRule: Record<string, Explanation>;
  readonly unreadable: boolean;
}

/** Re-reads `keys` silently and runs the engine; an unreadable section keeps its earlier value. */
async function reread(internals: ScanInternals, from: SystemState, keys: readonly SectionKey[]): Promise<Reread> {
  let state = from;
  let unreadable = false;
  let byRule = internals.cacheRef.current.byRule;
  for (const key of keys) {
    try {
      const section = await withDeadline(internals.deps.adapters.systemState.collectSection(key), SCAN_BUDGET_MS);
      state = replaceSection(state, key, section);
    } catch {
      unreadable = true;
      continue;
    }
    const partial = internals.deps.engine(state);
    byRule = survivingExplanations(byRule, partial, key);
  }
  const report = internals.deps.engine(state);
  return { state, report, byRule, unreadable };
}

export function useFixActions(internals: ScanInternals): FixActions {
  const { deps, dispatch, scanRef, cacheRef, generation } = internals;
  const applyAbortRef = useRef<AbortController | null>(null);
  const watcherRef = useRef<AwayPoller | null>(null);

  useEffect(() => () => watcherRef.current?.stop(), []);

  const previewFix = useCallback(
    async (ruleId: RuleId, choice: FixChoice) => {
      if (scanRef.current.kind !== "ready") return;
      try {
        const plan = await deps.adapters.fixes.preview(ruleId, choice);
        dispatch({ type: "fix_previewed", plan });
      } catch (error) {
        dispatch({ type: "fix_preview_failed", ruleId, error: asFixError(error) });
      }
    },
    [deps, dispatch, scanRef],
  );

  const applyFix = useCallback(
    async (passphrase?: string) => {
      const current = scanRef.current;
      if (current.kind !== "ready" || current.fixing === null || current.fixing.kind !== "single" || current.fixing.phase !== "confirm") return;
      const { plan } = current.fixing;
      const gen = generation.current;
      const controller = new AbortController();
      applyAbortRef.current = controller;
      dispatch({ type: "fix_progress", phase: plan.needsPassword ? "waiting_for_password" : "running", step: 1, of: plan.lines.length });
      const input = passphrase === undefined ? {} : { passphrase };
      const outcome = await deps.adapters.fixes.apply(plan.planId, input, {
        signal: controller.signal,
        onProgress: (p) => dispatch({ type: "fix_progress", phase: p.phase, step: p.step, of: p.of }),
      });
      applyAbortRef.current = null;
      if (generation.current !== gen) return;
      if (!outcome.ok) {
        dispatch({ type: "fix_failed", error: outcome.error, step: outcome.step });
        return;
      }
      dispatch({ type: "fix_rechecking" });
      const after = scanRef.current;
      if (after.kind !== "ready") return;
      const result = await reread(internals, after.state, plan.recheck);
      if (generation.current !== gen || scanRef.current.kind !== "ready") return;
      const verdict: RecheckResult = result.unreadable ? "unreadable" : rulePasses(result.report, plan.ruleId) ? "pass" : "still_failing";
      cacheRef.current = { byRule: result.byRule, order: null, priority: null };
      dispatch({ type: "fix_done", state: result.state, report: result.report, result: verdict, byRule: result.byRule });
      await internals.saveLast(result.report);
    },
    [deps, dispatch, scanRef, cacheRef, generation, internals],
  );

  const previewBatch = useCallback(
    async (ruleIds: readonly RuleId[]) => {
      if (scanRef.current.kind !== "ready") return;
      try {
        const plan = await deps.adapters.fixes.previewBatch(ruleIds);
        dispatch({ type: "batch_previewed", plan });
      } catch (error) {
        // A refused batch has no rule to pin it to; the first id names the sheet.
        dispatch({ type: "fix_preview_failed", ruleId: ruleIds[0] ?? ("TL-MAC-000" as RuleId), error: asFixError(error) });
      }
    },
    [deps, dispatch, scanRef],
  );

  const applyBatch = useCallback(async () => {
    const current = scanRef.current;
    if (current.kind !== "ready" || current.fixing === null || current.fixing.kind !== "batch" || current.fixing.phase !== "confirm") return;
    const { plan } = current.fixing;
    const gen = generation.current;
    const controller = new AbortController();
    applyAbortRef.current = controller;
    const of = plan.items.reduce((sum, item) => sum + item.lines.length, 0);
    dispatch({ type: "fix_progress", phase: plan.needsPassword ? "waiting_for_password" : "running", step: 1, of });
    let outcome: BatchOutcome;
    try {
      outcome = await deps.adapters.fixes.applyBatch(plan.planId, {
        signal: controller.signal,
        onProgress: (p) => dispatch({ type: "fix_progress", phase: p.phase, step: p.step, of: p.of, ...(p.item === undefined ? {} : { item: p.item }) }),
      });
    } catch (error) {
      outcome = { ok: false, items: [], error: asFixError(error) };
    }
    applyAbortRef.current = null;
    if (generation.current !== gen) return;
    // Whatever happened, the recheck tells which items took; a cancel may still have run some.
    dispatch({ type: "fix_rechecking" });
    const after = scanRef.current;
    if (after.kind !== "ready") return;
    const result = await reread(internals, after.state, plan.recheck);
    if (generation.current !== gen || scanRef.current.kind !== "ready") return;
    const verdicts: Record<string, RecheckResult> = {};
    for (const item of plan.items) {
      verdicts[item.ruleId] = result.unreadable ? "unreadable" : rulePasses(result.report, item.ruleId) ? "pass" : "still_failing";
    }
    cacheRef.current = { byRule: result.byRule, order: null, priority: null };
    dispatch({ type: "batch_done", state: result.state, report: result.report, outcome, byRule: result.byRule, verdicts });
    await internals.saveLast(result.report);
  }, [deps, dispatch, scanRef, cacheRef, generation, internals]);

  const dismissFix = useCallback(() => dispatch({ type: "fix_dismissed" }), [dispatch]);

  const cancelFix = useCallback(() => {
    const current = scanRef.current;
    if (current.kind !== "ready" || current.fixing === null) return;
    const phase = current.fixing.phase;
    if (phase === "waiting_for_password" || phase === "running") {
      applyAbortRef.current?.abort();
      return;
    }
    if (phase !== "rechecking") dispatch({ type: "fix_dismissed" });
  }, [dispatch, scanRef]);

  const stopWatch = useCallback(() => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    if (scanRef.current.kind === "ready" && scanRef.current.watching !== null) dispatch({ type: "watch_stopped" });
  }, [dispatch, scanRef]);

  const startWatch = useCallback(
    (ruleId: RuleId, watch?: WatchSpec) => {
      const current = scanRef.current;
      if (current.kind !== "ready") return;
      const finding = current.report.findings.find((f) => f.ruleId === ruleId);
      if (finding === undefined) return;
      let sections: readonly SectionKey[];
      let everyMs: number;
      if (watch !== undefined) {
        // The guided flow names the sections itself, so an in_app rule can be watched too.
        sections = watch.sections;
        everyMs = watch.everyMs > 0 ? watch.everyMs : WATCH_EVERY_MS;
      } else {
        if (finding.fix.apply.kind === "in_app") return;
        sections = finding.fix.apply.watch;
        everyMs = finding.fix.apply.watchEvery > 0 ? finding.fix.apply.watchEvery * 1000 : WATCH_EVERY_MS;
      }
      if (sections.length === 0) return;
      watcherRef.current?.stop();
      const gen = generation.current;
      dispatch({ type: "watch_started", ruleId, sections, everyMs, startedAt: new Date().toISOString() });
      const poller = awayPolling({
        everyMs,
        poll: async () => {
          const held = scanRef.current;
          if (generation.current !== gen || held.kind !== "ready" || held.watching?.ruleId !== ruleId) return "stop";
          const result = await reread(internals, held.state, sections);
          if (generation.current !== gen || scanRef.current.kind !== "ready") return "stop";
          if (result.unreadable) return "continue";
          const at = result.report.scannedAt;
          cacheRef.current = { byRule: result.byRule, order: null, priority: null };
          dispatch({ type: "watch_tick", state: result.state, report: result.report, at, byRule: result.byRule });
          if (!rulePasses(result.report, ruleId)) return "continue";
          dispatch({ type: "watch_passed", at });
          void internals.saveLast(result.report);
          return "stop";
        },
        onExpired: () => {
          if (watcherRef.current === poller) watcherRef.current = null;
          dispatch({ type: "watch_stopped" });
        },
      });
      watcherRef.current = poller;
    },
    [dispatch, scanRef, cacheRef, generation, internals],
  );

  const reveal = useCallback(
    async (ruleId: RuleId, choice: FixChoice) => {
      if (scanRef.current.kind !== "ready") return;
      try {
        await deps.adapters.fixes.reveal(ruleId, choice);
      } catch (error) {
        if (error instanceof DeadlineError) return;
        internals.setNotice("Finder could not show that item.");
        return;
      }
      startWatch(ruleId);
    },
    [deps, scanRef, startWatch, internals],
  );

  return { previewFix, applyFix, previewBatch, applyBatch, cancelFix, dismissFix, startWatch, stopWatch, reveal };
}
