import { describe, expect, it } from "vitest";
import type { Explanation, RuleId, ScanReport, SystemState } from "@talos/core";
import { DEV_MACHINE, HARDENED, SECTION_KEYS } from "@talos/core";
import { explainFrom, heldState, initialScanState, lastReport, reduce, replaceSection, survivingExplanations } from "./machine";
import type { ScanState } from "./machine";

function fakeReport(id: string): ScanReport {
  const sections = {} as Record<(typeof SECTION_KEYS)[number], { status: "ok" }>;
  for (const key of SECTION_KEYS) sections[key] = { status: "ok" };
  return {
    schemaVersion: 1,
    reportId: id,
    scannedAt: "2026-10-15T10:00:00.000Z",
    collectedAt: DEV_MACHINE.collectedAt,
    coreVersion: "0.1.0",
    catalogVersion: "0.1.0",
    cisEdition: "test",
    platform: DEV_MACHINE.host,
    sections,
    score: {
      value: 38,
      grade: "at_risk",
      deducted: 62,
      cappedByCritical: false,
      complete: false,
      counts: { pass: 17, fail: 9, review: 3, unknown: 1, not_applicable: 1 },
    },
    results: [],
    findings: [],
  };
}

const REPORT_A = fakeReport("a");
const REPORT_B = fakeReport("b");
const STARTED = "2026-10-15T10:00:00.000Z";

function collecting(): ScanState {
  return reduce(initialScanState, { type: "scan_started", startedAt: STARTED });
}

function ready(state: SystemState = DEV_MACHINE, report: ScanReport = REPORT_A): ScanState {
  const evaluating = reduce(collecting(), { type: "collected", state });
  return reduce(reduce(evaluating, { type: "evaluated", report }), { type: "presented" });
}

const EMPTY = { byRule: {}, order: null, priority: null };

const EXPLANATION: Explanation = {
  ruleId: "TL-MAC-001",
  whyItMattersForYou: "why",
  whatCouldHappen: "what",
  urgency: "today",
};

describe("scan reducer", () => {
  it("starts idle with no last report", () => {
    expect(initialScanState).toEqual({ kind: "idle", last: null });
  });

  it("idle: last_loaded stores the report; ignored elsewhere", () => {
    expect(reduce(initialScanState, { type: "last_loaded", report: REPORT_A })).toEqual({ kind: "idle", last: REPORT_A });
    const busy = collecting();
    expect(reduce(busy, { type: "last_loaded", report: REPORT_A })).toBe(busy);
  });

  it("idle -> collecting on scan_started with every section pending", () => {
    const state = collecting();
    expect(state.kind).toBe("collecting");
    if (state.kind !== "collecting") return;
    expect(state.startedAt).toBe(STARTED);
    expect(Object.keys(state.sections).sort()).toEqual([...SECTION_KEYS].sort());
    expect(Object.values(state.sections).every((s) => s === "pending")).toBe(true);
  });

  it("collecting: section_progress marks ok and unavailable; started is a no-op", () => {
    let state = collecting();
    const before = state;
    state = reduce(state, { type: "section_progress", key: "firewall", status: "started" });
    expect(state).toBe(before);
    state = reduce(state, { type: "section_progress", key: "firewall", status: "ok" });
    state = reduce(state, { type: "section_progress", key: "browsers", status: "unavailable" });
    expect(state.kind).toBe("collecting");
    if (state.kind !== "collecting") return;
    expect(state.sections.firewall).toBe("ok");
    expect(state.sections.browsers).toBe("unavailable");
    expect(state.sections.ssh).toBe("pending");
  });

  it("section_progress outside collecting is ignored", () => {
    const state = ready();
    expect(reduce(state, { type: "section_progress", key: "firewall", status: "ok" })).toBe(state);
  });

  it("collecting -> evaluating on collected", () => {
    const state = reduce(collecting(), { type: "collected", state: DEV_MACHINE });
    expect(state).toEqual({ kind: "evaluating", state: DEV_MACHINE, previous: null });
  });

  it("evaluating -> presenting -> ready with explain off and no fix or watch", () => {
    const state = ready();
    expect(state).toEqual({ kind: "ready", report: REPORT_A, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null });
  });

  it("collecting -> failed on collect_failed and keeps the last report", () => {
    const state = reduce(collecting(), { type: "collect_failed", error: "collector_crashed", last: REPORT_A });
    expect(state).toEqual({ kind: "failed", error: "collector_crashed", last: REPORT_A });
  });

  it("cancel: collecting -> failed with cancelled", () => {
    const state = reduce(collecting(), { type: "collect_failed", error: "cancelled", last: null });
    expect(state).toEqual({ kind: "failed", error: "cancelled", last: null });
  });

  it("collect_failed outside collecting is ignored", () => {
    const state = ready();
    expect(reduce(state, { type: "collect_failed", error: "timeout", last: null })).toBe(state);
  });

  it("ready -> collecting on rescan", () => {
    const state = reduce(ready(), { type: "scan_started", startedAt: STARTED });
    expect(state.kind).toBe("collecting");
  });

  it("failed -> collecting on rescan", () => {
    const failed = reduce(collecting(), { type: "collect_failed", error: "cancelled", last: REPORT_A });
    const state = reduce(failed, { type: "scan_started", startedAt: STARTED });
    expect(state.kind).toBe("collecting");
  });

  it("scan_started is ignored while collecting or evaluating", () => {
    const c = collecting();
    expect(reduce(c, { type: "scan_started", startedAt: STARTED })).toBe(c);
    const e = reduce(c, { type: "collected", state: DEV_MACHINE });
    expect(reduce(e, { type: "scan_started", startedAt: STARTED })).toBe(e);
  });

  it("rechecking -> collecting on rescan, so a hung recheck cannot block a new scan", () => {
    const r = reduce(ready(), { type: "recheck_started", key: "firewall" });
    const state = reduce(r, { type: "scan_started", startedAt: STARTED });
    expect(state.kind).toBe("collecting");
    expect(reduce(state, { type: "recheck_done", state: DEV_MACHINE, report: REPORT_B, byRule: {} })).toBe(state);
    expect(reduce(state, { type: "recheck_failed", byRule: {}, order: null })).toBe(state);
  });

  it("a rescan remembers the ready state it interrupts, and a cancel goes back to it", () => {
    const before = reduce(ready(), { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order: ["TL-MAC-001"] });
    const collecting = reduce(before, { type: "scan_started", startedAt: STARTED });
    expect(collecting.kind === "collecting" && collecting.previous).toEqual(before);
    const back = reduce(collecting, { type: "collect_failed", error: "cancelled", last: REPORT_A });
    expect(back).toEqual(before);
    expect(heldState(back)).toBe(DEV_MACHINE);
  });

  it("a cancelled rescan drops an explanation that was still running", () => {
    const running = reduce(ready(), { type: "explain_started", target: "TL-MAC-001" });
    const collecting = reduce(running, { type: "scan_started", startedAt: STARTED });
    const back = reduce(collecting, { type: "collect_failed", error: "cancelled", last: REPORT_A });
    expect(back.kind === "ready" && back.explain).toEqual({ kind: "off" });
  });

  it("a rescan started during a recheck goes back to the pre-recheck report when cancelled", () => {
    const rechecking = reduce(ready(), { type: "recheck_started", key: "firewall" });
    const collecting = reduce(rechecking, { type: "scan_started", startedAt: STARTED });
    const back = reduce(collecting, { type: "collect_failed", error: "cancelled", last: REPORT_A });
    expect(back).toEqual({ kind: "ready", report: REPORT_A, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null });
  });

  it("only a cancel goes back; any other failure of a rescan still lands in failed", () => {
    const collecting = reduce(ready(), { type: "scan_started", startedAt: STARTED });
    for (const error of ["timeout", "collector_crashed", "schema_mismatch"] as const) {
      expect(reduce(collecting, { type: "collect_failed", error, last: REPORT_A })).toEqual({ kind: "failed", error, last: REPORT_A });
    }
  });

  it("a cancel with nothing to go back to lands in failed", () => {
    const fromIdle = reduce({ kind: "idle", last: REPORT_A }, { type: "scan_started", startedAt: STARTED });
    expect(fromIdle.kind === "collecting" && fromIdle.previous).toBeNull();
    expect(reduce(fromIdle, { type: "collect_failed", error: "cancelled", last: REPORT_A })).toEqual({ kind: "failed", error: "cancelled", last: REPORT_A });
  });

  it("failed -> idle on failure_dismissed, keeping the last report; ignored elsewhere", () => {
    const failed = reduce(collecting(), { type: "collect_failed", error: "cancelled", last: REPORT_A });
    expect(reduce(failed, { type: "failure_dismissed" })).toEqual({ kind: "idle", last: REPORT_A });
    const none = reduce(collecting(), { type: "collect_failed", error: "timeout", last: null });
    expect(reduce(none, { type: "failure_dismissed" })).toEqual({ kind: "idle", last: null });
    const r = ready();
    expect(reduce(r, { type: "failure_dismissed" })).toBe(r);
  });

  it("ready -> rechecking on recheck_started, keeping report and state", () => {
    const state = reduce(ready(), { type: "recheck_started", key: "firewall" });
    expect(state).toEqual({ kind: "rechecking", report: REPORT_A, state: DEV_MACHINE, key: "firewall", explain: { kind: "off" }, watching: null });
  });

  it("recheck_started keeps an explanation on screen and drops one still running", () => {
    const shown = reduce(ready(), { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order: null });
    const rechecking = reduce(shown, { type: "recheck_started", key: "firewall" });
    expect(rechecking.kind === "rechecking" && rechecking.explain).toEqual({ kind: "ready", byRule: { "TL-MAC-001": EXPLANATION }, order: null, priority: null });
    const running = reduce(ready(), { type: "explain_started", target: "TL-MAC-001" });
    const r2 = reduce(running, { type: "recheck_started", key: "firewall" });
    expect(r2.kind === "rechecking" && r2.explain).toEqual({ kind: "off" });
  });

  it("recheck_started outside ready is ignored", () => {
    const c = collecting();
    expect(reduce(c, { type: "recheck_started", key: "firewall" })).toBe(c);
  });

  it("rechecking -> ready on recheck_done with the new state and report", () => {
    const rechecking = reduce(ready(), { type: "recheck_started", key: "firewall" });
    const next = replaceSection(DEV_MACHINE, "firewall", HARDENED.sections.firewall);
    const state = reduce(rechecking, { type: "recheck_done", state: next, report: REPORT_B, byRule: {} });
    expect(state).toEqual({
      kind: "ready",
      report: REPORT_B,
      state: next,
      explain: { kind: "off" },
      lastRecheck: { key: "firewall", at: REPORT_B.scannedAt },
      fixing: null,
      watching: null,
    });
  });

  it("rechecking -> ready on recheck_failed with the previous report and no recheck record", () => {
    const rechecking = reduce(ready(), { type: "recheck_started", key: "firewall" });
    const state = reduce(rechecking, { type: "recheck_failed", byRule: {}, order: null });
    expect(state).toEqual({ kind: "ready", report: REPORT_A, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null });
  });

  it("recheck_failed hands back the explanations and order, since the report did not change", () => {
    const rechecking = reduce(ready(), { type: "recheck_started", key: "firewall" });
    const order: RuleId[] = ["TL-MAC-001"];
    const state = reduce(rechecking, { type: "recheck_failed", byRule: { "TL-MAC-001": EXPLANATION }, order });
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "ready", byRule: { "TL-MAC-001": EXPLANATION }, order, priority: null });
  });

  it("a rescan drops the recheck record", () => {
    const rechecking = reduce(ready(), { type: "recheck_started", key: "firewall" });
    let state = reduce(rechecking, { type: "recheck_done", state: DEV_MACHINE, report: REPORT_B, byRule: {} });
    expect(state.kind === "ready" && state.lastRecheck).not.toBeNull();
    state = reduce(state, { type: "scan_started", startedAt: STARTED });
    state = reduce(state, { type: "collected", state: DEV_MACHINE });
    state = reduce(state, { type: "evaluated", report: REPORT_A });
    state = reduce(state, { type: "presented" });
    expect(state.kind === "ready" && state.lastRecheck).toBeNull();
  });

  it("recheck_done outside rechecking is ignored", () => {
    const state = ready();
    expect(reduce(state, { type: "recheck_done", state: DEV_MACHINE, report: REPORT_B, byRule: {} })).toBe(state);
  });

  it("replaceSection swaps one section and leaves the rest", () => {
    const next = replaceSection(DEV_MACHINE, "firewall", HARDENED.sections.firewall);
    expect(next.sections.firewall).toBe(HARDENED.sections.firewall);
    expect(next.sections.ssh).toBe(DEV_MACHINE.sections.ssh);
    expect(next.host).toBe(DEV_MACHINE.host);
    expect(DEV_MACHINE.sections.firewall).not.toBe(HARDENED.sections.firewall);
  });

  it("explain: ready -> running -> ready with byRule and order", () => {
    let state = reduce(ready(), { type: "explain_started", target: "TL-MAC-001" });
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "running", target: "TL-MAC-001", partial: null, answerPartial: null, from: EMPTY });
    const order: RuleId[] = ["TL-MAC-001", "TL-MAC-002"];
    state = reduce(state, { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order });
    expect(state.kind === "ready" && state.explain).toEqual({
      kind: "ready",
      byRule: { "TL-MAC-001": EXPLANATION },
      order,
      priority: null,
    });
    expect(state.kind === "ready" && state.report).toBe(REPORT_A);
  });

  it("explain: prioritise target and failure", () => {
    let state = reduce(ready(), { type: "explain_started", target: "prioritise" });
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "running", target: "prioritise", partial: null, answerPartial: null, from: EMPTY });
    state = reduce(state, { type: "explain_failed", reason: "no_api_key", target: "prioritise", byRule: {}, order: null });
    expect(state.kind === "ready" && state.explain).toEqual({
      kind: "failed",
      reason: "no_api_key",
      target: "prioritise",
      byRule: {},
      order: null,
      priority: null,
    });
  });

  it("explain_failed keeps the explanations and order already shown", () => {
    const order: RuleId[] = ["TL-MAC-001"];
    let state = reduce(ready(), { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order });
    state = reduce(state, { type: "explain_started", target: "TL-MAC-002" });
    state = reduce(state, { type: "explain_failed", reason: "timeout", target: "TL-MAC-002", byRule: { "TL-MAC-001": EXPLANATION }, order });
    expect(state.kind === "ready" && state.explain).toEqual({
      kind: "failed",
      reason: "timeout",
      target: "TL-MAC-002",
      byRule: { "TL-MAC-001": EXPLANATION },
      order,
      priority: null,
    });
  });

  it("explain actions outside ready are ignored", () => {
    const c = collecting();
    expect(reduce(c, { type: "explain_started", target: "prioritise" })).toBe(c);
    expect(reduce(c, { type: "explain_ready", byRule: {}, order: null })).toBe(c);
    expect(reduce(c, { type: "explain_failed", reason: "unknown", target: "prioritise", byRule: {}, order: null })).toBe(c);
  });

  it("a recheck keeps the explanations the hook says survive and always drops the order", () => {
    let state = reduce(ready(), { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order: ["TL-MAC-001"] });
    state = reduce(state, { type: "recheck_started", key: "firewall" });
    state = reduce(state, { type: "recheck_done", state: DEV_MACHINE, report: REPORT_B, byRule: { "TL-MAC-001": EXPLANATION } });
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "ready", byRule: { "TL-MAC-001": EXPLANATION }, order: null, priority: null });
    state = reduce(state, { type: "recheck_started", key: "diskEncryption" });
    state = reduce(state, { type: "recheck_done", state: DEV_MACHINE, report: REPORT_B, byRule: {} });
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "off" });
  });

  it("explainFrom is off only when nothing is cached", () => {
    expect(explainFrom({}, null)).toEqual({ kind: "off" });
    expect(explainFrom({ "TL-MAC-001": EXPLANATION }, null)).toEqual({ kind: "ready", byRule: { "TL-MAC-001": EXPLANATION }, order: null, priority: null });
    expect(explainFrom({}, ["TL-MAC-001"])).toEqual({ kind: "ready", byRule: {}, order: ["TL-MAC-001"], priority: null });
  });

  it("survivingExplanations drops rules that depend on the rechecked section or left the report", () => {
    const finding = (ruleId: RuleId, requires: readonly (typeof SECTION_KEYS)[number][]) => ({
      ruleId,
      title: "t",
      headline: "h",
      severity: "high" as const,
      category: "network" as const,
      cis: null,
      requires,
      status: "fail" as const,
      evidence: [],
      unknownReason: null,
      points: 8,
      explanation: "x",
      guided: { headline: "Fix this", why: "It matters.", verb: "Fix it for me", done: "Done. Fixed.", where: null },
      fix: { summary: "x", settingsPath: null, settingsPane: null, commands: [], steps: [], verify: null, effort: "two_minutes" as const, sideEffects: "none" as const, apply: { kind: "manual" as const, watch: [], watchEvery: 0, reveal: null } },
    });
    const report: ScanReport = { ...REPORT_A, findings: [finding("TL-MAC-001", ["diskEncryption"]), finding("TL-MAC-002", ["firewall"])] };
    const other: Explanation = { ...EXPLANATION, ruleId: "TL-MAC-002" };
    const gone: Explanation = { ...EXPLANATION, ruleId: "TL-MAC-004" };
    const byRule = { "TL-MAC-001": EXPLANATION, "TL-MAC-002": other, "TL-MAC-004": gone };
    expect(survivingExplanations(byRule, report, "firewall")).toEqual({ "TL-MAC-001": EXPLANATION });
    expect(survivingExplanations(byRule, report, "ssh")).toEqual({ "TL-MAC-001": EXPLANATION, "TL-MAC-002": other });
  });

  it("lastReport and heldState read every kind", () => {
    expect(lastReport(initialScanState)).toBeNull();
    expect(lastReport({ kind: "idle", last: REPORT_A })).toBe(REPORT_A);
    expect(lastReport(collecting())).toBeNull();
    expect(lastReport(reduce(collecting(), { type: "collected", state: DEV_MACHINE }))).toBeNull();
    expect(lastReport(ready())).toBe(REPORT_A);
    expect(lastReport(reduce(ready(), { type: "recheck_started", key: "ssh" }))).toBe(REPORT_A);
    expect(lastReport({ kind: "failed", error: "cancelled", last: REPORT_B })).toBe(REPORT_B);
    expect(heldState(ready())).toBe(DEV_MACHINE);
    expect(heldState(initialScanState)).toBeNull();
  });
});
