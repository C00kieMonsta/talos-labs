import { useEffect, useMemo, useRef, useState } from "react";
import type { ScanReport, SectionKey } from "@talos/core";
import { SECTION_KEYS } from "@talos/core";
import type { ScanController } from "./useScan";
import type { ScanState } from "./machine";

export type RowState = "pending" | "checking" | "prompting" | "checked" | "fine" | "attention" | "review" | "unavailable";

export interface PacerTiming {
  readonly firstCheckingMs: number;
  readonly firstRevealMs: number;
  readonly rowMs: number;
  readonly catchUpMs: number;
  readonly promptingAfterMs: number;
  readonly preparingGapMs: number;
  readonly floorMs: number;
}

export const PACER_TIMING: PacerTiming = {
  firstCheckingMs: 300,
  firstRevealMs: 570,
  rowMs: 270,
  catchUpMs: 120,
  promptingAfterMs: 3000,
  preparingGapMs: 300,
  floorMs: 6000,
};

export const REDUCED_MOTION_TIMING: PacerTiming = { ...PACER_TIMING, rowMs: 200, floorMs: 4500 };

export interface PacerOptions {
  readonly reducedMotion?: boolean;
  /** Multiplies every delay; 0 collapses the schedule. Defaults to window.__talosDemoPace or 1. */
  readonly pace?: number;
}

export interface PacerView {
  readonly rows: Readonly<Record<SectionKey, RowState>>;
  readonly found: { readonly attention: number; readonly review: number };
  readonly phase: "areas" | "preparing" | "done";
  /** 0 to 1. */
  readonly progress: number;
  readonly revealed: number;
}

/** Verdict per section from the report: a rule counts for the first section it requires. */
export function sectionVerdicts(report: ScanReport): Record<SectionKey, "fine" | "attention" | "review" | "unavailable"> {
  const verdicts = {} as Record<SectionKey, "fine" | "attention" | "review" | "unavailable">;
  for (const key of SECTION_KEYS) verdicts[key] = report.sections[key].status === "ok" ? "fine" : "unavailable";
  for (const finding of report.findings) {
    const key = finding.requires[0];
    if (key === undefined || verdicts[key] === "unavailable") continue;
    if (finding.status === "fail") verdicts[key] = "attention";
    else if (finding.status === "review" && verdicts[key] === "fine") verdicts[key] = "review";
  }
  return verdicts;
}

/** fail and review findings attributed to the first `revealed` sections. */
export function foundSoFar(report: ScanReport | null, revealed: number): { attention: number; review: number } {
  if (report === null) return { attention: 0, review: 0 };
  const shown = new Set<SectionKey>(SECTION_KEYS.slice(0, revealed));
  let attention = 0;
  let review = 0;
  for (const finding of report.findings) {
    const key = finding.requires[0];
    if (key === undefined || !shown.has(key)) continue;
    if (finding.status === "fail") attention += 1;
    else if (finding.status === "review") review += 1;
  }
  return { attention, review };
}

function defaultPace(): number {
  if (typeof window === "undefined") return 1;
  const pace = window.__talosDemoPace;
  return typeof pace === "number" && pace >= 0 ? pace : 1;
}

interface Local {
  readonly revealed: number;
  readonly checking: number;
  readonly prompting: boolean;
  readonly phase: "areas" | "preparing" | "done";
}

const IDLE: Local = { revealed: 0, checking: 0, prompting: false, phase: "areas" };

function isScanning(scan: ScanState): boolean {
  return scan.kind === "collecting" || scan.kind === "evaluating" || scan.kind === "presenting";
}

/** Paces the reveal of a report the engine already holds. Timers live here; the machine only counts rows. */
export function useScanPacer(controller: ScanController, options: PacerOptions = {}): PacerView {
  const { scan } = controller;
  const timing = options.reducedMotion === true ? REDUCED_MOTION_TIMING : PACER_TIMING;
  const pace = options.pace ?? defaultPace();
  const scale = (ms: number) => ms * pace;
  const [local, setLocal] = useState<Local>(IDLE);
  const localRef = useRef<Local>(IDLE);
  const t0 = useRef<number | null>(null);
  const arrivals = useRef<Partial<Record<SectionKey, number>>>({});
  const lastRevealAt = useRef<number | null>(null);
  const preparingAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const scanning = isScanning(scan);
  const report = scan.kind === "presenting" ? scan.report : null;

  useEffect(() => {
    const clear = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const update = (next: Local) => {
      localRef.current = next;
      setLocal(next);
    };
    if (!scanning) {
      clear();
      t0.current = null;
      arrivals.current = {};
      lastRevealAt.current = null;
      preparingAt.current = null;
      if (localRef.current !== IDLE) update(IDLE);
      return;
    }
    const now = Date.now();
    t0.current ??= now;
    for (const key of SECTION_KEYS) {
      const arrived = scan.kind !== "collecting" || scan.sections[key] !== "pending";
      if (arrived && arrivals.current[key] === undefined) arrivals.current[key] = now;
    }

    const step = () => {
      clear();
      const start = t0.current ?? Date.now();
      const at = Date.now();
      let state = localRef.current;
      let nextAt: number | null = null;
      const consider = (candidate: number) => {
        if (candidate > at && (nextAt === null || candidate < nextAt)) nextAt = candidate;
      };
      const checking = Math.min(
        SECTION_KEYS.length,
        SECTION_KEYS.filter((_, i) => at >= start + scale(timing.firstCheckingMs + timing.rowMs * i)).length,
      );
      if (checking < SECTION_KEYS.length) consider(start + scale(timing.firstCheckingMs + timing.rowMs * checking));
      let revealed = state.revealed;
      let prompting = false;
      while (revealed < SECTION_KEYS.length) {
        const key = SECTION_KEYS[revealed] as SectionKey;
        const scheduled = start + scale(timing.firstRevealMs + timing.rowMs * revealed);
        const dueAt = Math.max(scheduled, lastRevealAt.current === null ? 0 : lastRevealAt.current + scale(timing.catchUpMs));
        const arrived = arrivals.current[key] !== undefined;
        if (!arrived) {
          // The schedule waits on this row; only loginItems says why after a while.
          if (key === "loginItems" && at >= dueAt + scale(timing.promptingAfterMs)) prompting = true;
          else if (key === "loginItems") consider(dueAt + scale(timing.promptingAfterMs));
          break;
        }
        if (at < dueAt) {
          consider(dueAt);
          break;
        }
        revealed += 1;
        lastRevealAt.current = at;
        if (scan.kind === "presenting") controllerRef.current.revealRow();
      }
      let phase = state.phase;
      if (revealed === SECTION_KEYS.length && phase === "areas" && scan.kind === "presenting") {
        const due = Math.max(
          start + scale(timing.firstRevealMs + timing.rowMs * (SECTION_KEYS.length - 1) + timing.preparingGapMs),
          (lastRevealAt.current ?? at) + scale(timing.preparingGapMs),
        );
        if (at >= due) {
          phase = "preparing";
          preparingAt.current = at;
          controllerRef.current.markPreparing();
        } else consider(due);
      }
      if (phase === "preparing") {
        const transition = timing.floorMs - (timing.firstRevealMs + timing.rowMs * (SECTION_KEYS.length - 1) + timing.preparingGapMs);
        const due = Math.max(start + scale(timing.floorMs), (preparingAt.current ?? at) + scale(transition));
        if (at >= due) {
          phase = "done";
          void controllerRef.current.present();
        } else consider(due);
      }
      state = { revealed, checking: Math.max(checking, revealed), prompting, phase };
      if (
        state.revealed !== localRef.current.revealed ||
        state.checking !== localRef.current.checking ||
        state.prompting !== localRef.current.prompting ||
        state.phase !== localRef.current.phase
      ) {
        update(state);
      }
      if (nextAt !== null && phase !== "done") timer.current = setTimeout(step, Math.max(0, nextAt - Date.now()));
    };
    step();
    return clear;
    // scan identity changes on every progress event, which is what re-runs the schedule.
  }, [scan, scanning, timing, pace]);

  const verdicts = useMemo(() => (report === null ? null : sectionVerdicts(report)), [report]);
  const rows = useMemo(() => {
    const out = {} as Record<SectionKey, RowState>;
    SECTION_KEYS.forEach((key, i) => {
      if (i < local.revealed) {
        if (verdicts !== null) out[key] = verdicts[key];
        else out[key] = scan.kind === "collecting" && scan.sections[key] === "unavailable" ? "unavailable" : "checked";
      } else if (i < local.checking) {
        out[key] = local.prompting && key === "loginItems" ? "prompting" : "checking";
      } else out[key] = "pending";
    });
    return out;
  }, [local, verdicts, scan]);

  const found = useMemo(() => foundSoFar(report, local.revealed), [report, local.revealed]);
  const progress = local.phase === "areas" ? local.revealed / SECTION_KEYS.length : 1;
  return { rows, found, phase: local.phase, progress, revealed: local.revealed };
}
