import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ALL_UNAVAILABLE, DEV_MACHINE, MACOS_CATALOG, SECTION_KEYS, evaluate } from "@talos/core";
import type { SectionKey } from "@talos/core";
import { fakeScanController } from "../app/testing";
import { initialScanState, reduce } from "./machine";
import type { ScanState } from "./machine";
import { foundSoFar, sectionVerdicts, useScanPacer } from "./useScanPacer";
import type { PacerOptions } from "./useScanPacer";

const NOW = "2026-10-15T10:00:00.000Z";
const REPORT = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Drives the hook with a mutable scan state, the way useScan would. */
function harness(options: PacerOptions = {}) {
  let state: ScanState = initialScanState;
  const controller = fakeScanController(state);
  const hook = renderHook(() => useScanPacer({ ...controller, scan: state }, options));
  const dispatch = (action: Parameters<typeof reduce>[1]) => {
    state = reduce(state, action);
    act(() => hook.rerender());
  };
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const start = () => dispatch({ type: "scan_started", startedAt: NOW });
  const arrive = (key: SectionKey, status: "ok" | "unavailable" = "ok") => dispatch({ type: "section_progress", key, status });
  const arriveAll = () => {
    for (const key of SECTION_KEYS) arrive(key);
  };
  const landReport = () => {
    dispatch({ type: "collected", state: DEV_MACHINE });
    dispatch({ type: "evaluated", report: REPORT });
  };
  return { hook, controller, dispatch, tick, start, arrive, arriveAll, landReport, get state() { return state; } };
}

describe("useScanPacer", () => {
  it("reveals row i at 570 + 270·i once the report is there, with the bar and the subline following", async () => {
    const h = harness();
    h.start();
    h.arriveAll();
    h.landReport();
    await h.tick(569);
    expect(h.hook.result.current.revealed).toBe(0);
    expect(h.hook.result.current.rows.diskEncryption).toBe("checking");
    await h.tick(1);
    expect(h.hook.result.current.revealed).toBe(1);
    expect(h.hook.result.current.rows.diskEncryption).toBe(sectionVerdicts(REPORT).diskEncryption);
    await h.tick(270 * 3);
    expect(h.hook.result.current.revealed).toBe(4);
    expect(h.hook.result.current.progress).toBeCloseTo(4 / 17);
    expect(h.controller.revealRow).toHaveBeenCalledTimes(4);
  });

  it("never reveals a row before its own progress event, pauses on it, then catches up at 120 ms", async () => {
    const h = harness();
    h.start();
    for (const key of SECTION_KEYS) if (key !== "firewall") h.arrive(key);
    await h.tick(570);
    expect(h.hook.result.current.revealed).toBe(1);
    await h.tick(3000);
    expect(h.hook.result.current.revealed).toBe(1);
    expect(h.hook.result.current.rows.firewall).toBe("checking");
    h.arrive("firewall");
    await h.tick(0);
    expect(h.hook.result.current.revealed).toBe(2);
    await h.tick(120);
    expect(h.hook.result.current.revealed).toBe(3);
    await h.tick(120);
    expect(h.hook.result.current.revealed).toBe(4);
  });

  it("reveals as checked before the report lands and swaps to the verdict in place without a second reveal", async () => {
    const h = harness();
    h.start();
    h.arriveAll();
    await h.tick(570);
    expect(h.hook.result.current.rows.diskEncryption).toBe("checked");
    expect(h.hook.result.current.found).toEqual({ attention: 0, review: 0 });
    h.landReport();
    expect(h.hook.result.current.revealed).toBe(1);
    expect(h.hook.result.current.rows.diskEncryption).toBe("attention");
    expect(h.hook.result.current.found.attention).toBeGreaterThan(0);
    expect(h.controller.revealRow).toHaveBeenCalledTimes(0);
  });

  it("an unavailable event reveals as unavailable at once", async () => {
    const h = harness();
    h.start();
    h.arrive("diskEncryption", "unavailable");
    await h.tick(570);
    expect(h.hook.result.current.rows.diskEncryption).toBe("unavailable");
  });

  it("says why loginItems is waiting after 3000 ms, and on no other row", async () => {
    const h = harness();
    h.start();
    for (const key of SECTION_KEYS) if (key !== "loginItems" && key !== "ssh") h.arrive(key);
    const i = SECTION_KEYS.indexOf("loginItems");
    await h.tick(570 + 270 * i + 2999);
    expect(h.hook.result.current.rows.loginItems).toBe("checking");
    await h.tick(1);
    expect(h.hook.result.current.rows.loginItems).toBe("prompting");
    h.arrive("loginItems");
    await h.tick(0);
    const j = SECTION_KEYS.indexOf("ssh");
    await h.tick(120 * (j - i) + 3000);
    expect(h.hook.result.current.rows.ssh).toBe("checking");
  });

  it("holds the floor at 6000 ms, 4500 under reduced motion, then presents", async () => {
    const h = harness();
    h.start();
    h.arriveAll();
    h.landReport();
    await h.tick(5189);
    expect(h.hook.result.current.phase).toBe("areas");
    await h.tick(1);
    expect(h.hook.result.current.phase).toBe("preparing");
    expect(h.controller.markPreparing).toHaveBeenCalledTimes(1);
    await h.tick(809);
    expect(h.controller.present).not.toHaveBeenCalled();
    await h.tick(1);
    expect(h.controller.present).toHaveBeenCalledTimes(1);
    expect(h.hook.result.current.phase).toBe("done");
    cleanup();
    const r = harness({ reducedMotion: true });
    r.start();
    r.arriveAll();
    r.landReport();
    await r.tick(4499);
    expect(r.controller.present).not.toHaveBeenCalled();
    await r.tick(1);
    expect(r.controller.present).toHaveBeenCalledTimes(1);
  });

  it("resets when the scan is cancelled before or after the report", async () => {
    const h = harness();
    h.start();
    h.arriveAll();
    await h.tick(1000);
    expect(h.hook.result.current.revealed).toBe(2);
    h.dispatch({ type: "collect_failed", error: "cancelled", last: null });
    expect(h.hook.result.current.revealed).toBe(0);
    h.start();
    h.arriveAll();
    h.landReport();
    await h.tick(2000);
    expect(h.hook.result.current.revealed).toBeGreaterThan(2);
    h.dispatch({ type: "presentation_cancelled" });
    expect(h.hook.result.current.revealed).toBe(0);
    expect(h.hook.result.current.phase).toBe("areas");
    await h.tick(10_000);
    expect(h.controller.present).not.toHaveBeenCalled();
  });

  it("pace 0 collapses the schedule", async () => {
    const h = harness({ pace: 0 });
    h.start();
    h.arriveAll();
    h.landReport();
    await h.tick(0);
    expect(h.hook.result.current.revealed).toBe(17);
    expect(h.controller.present).toHaveBeenCalledTimes(1);
  });
});

describe("foundSoFar and sectionVerdicts", () => {
  it("counts fail and review findings attributed to revealed rows and ignores the rest", () => {
    expect(foundSoFar(null, 17)).toEqual({ attention: 0, review: 0 });
    const all = foundSoFar(REPORT, 17);
    expect(all.attention).toBe(REPORT.findings.filter((f) => f.status === "fail").length);
    expect(all.review).toBe(REPORT.findings.filter((f) => f.status === "review").length);
    expect(foundSoFar(REPORT, 0)).toEqual({ attention: 0, review: 0 });
  });

  it("gives each section one verdict, attention over review over fine", () => {
    const v = sectionVerdicts(REPORT);
    expect(v.firewall).toBe("attention");
    expect(v.platformIntegrity).toBe("fine");
    expect(sectionVerdicts(evaluate(ALL_UNAVAILABLE, MACOS_CATALOG, { now: NOW, os: "macos" })).browsers).toBe("unavailable");
  });
});
