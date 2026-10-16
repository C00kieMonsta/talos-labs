import { useCallback, useEffect, useRef } from "react";
import type { Explanation, FixChoice, FixError, RuleId, ScanReport, SectionKey, SystemState } from "@talos/core";
import { awayPolling, type AwayPoller } from "./awayPolling";
import { replaceSection, rulePasses, survivingExplanations } from "./machine";
import type { RecheckResult } from "./machine";
import type { FixActions, ScanInternals } from "./useScan";
import { DeadlineError, SCAN_BUDGET_MS, withDeadline } from "./useScan";

/** Default interval for a watcher whose rule names none. */
export const WATCH_EVERY_MS = 3000;

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
      if (current.kind !== "ready" || current.fixing === null || current.fixing.phase !== "confirm") return;
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
    (ruleId: RuleId) => {
      const current = scanRef.current;
      if (current.kind !== "ready") return;
      const finding = current.report.findings.find((f) => f.ruleId === ruleId);
      if (finding === undefined || finding.fix.apply.kind === "in_app") return;
      const sections = finding.fix.apply.watch;
      if (sections.length === 0) return;
      const everyMs = finding.fix.apply.watchEvery > 0 ? finding.fix.apply.watchEvery * 1000 : WATCH_EVERY_MS;
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

  return { previewFix, applyFix, cancelFix, dismissFix, startWatch, stopWatch, reveal };
}
