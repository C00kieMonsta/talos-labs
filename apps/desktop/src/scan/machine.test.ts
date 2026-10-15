import { describe, expect, it } from "vitest";
import type { Explanation, RuleId, ScanReport, SystemState } from "@talos/core";
import { DEV_MACHINE, HARDENED, SECTION_KEYS } from "@talos/core";
import { heldState, initialScanState, lastReport, reduce, replaceSection } from "./machine";
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
  return reduce(evaluating, { type: "evaluated", report });
}

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
    expect(state).toEqual({ kind: "evaluating", state: DEV_MACHINE });
  });

  it("evaluating -> ready on evaluated with explain off", () => {
    const state = ready();
    expect(state).toEqual({ kind: "ready", report: REPORT_A, state: DEV_MACHINE, explain: { kind: "off" } });
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

  it("scan_started is ignored while collecting, evaluating or rechecking", () => {
    const c = collecting();
    expect(reduce(c, { type: "scan_started", startedAt: STARTED })).toBe(c);
    const e = reduce(c, { type: "collected", state: DEV_MACHINE });
    expect(reduce(e, { type: "scan_started", startedAt: STARTED })).toBe(e);
    const r = reduce(ready(), { type: "recheck_started", key: "firewall" });
    expect(reduce(r, { type: "scan_started", startedAt: STARTED })).toBe(r);
  });

  it("ready -> rechecking on recheck_started, keeping report and state", () => {
    const state = reduce(ready(), { type: "recheck_started", key: "firewall" });
    expect(state).toEqual({ kind: "rechecking", report: REPORT_A, state: DEV_MACHINE, key: "firewall" });
  });

  it("recheck_started outside ready is ignored", () => {
    const c = collecting();
    expect(reduce(c, { type: "recheck_started", key: "firewall" })).toBe(c);
  });

  it("rechecking -> ready on recheck_done with the new state and report", () => {
    const rechecking = reduce(ready(), { type: "recheck_started", key: "firewall" });
    const next = replaceSection(DEV_MACHINE, "firewall", HARDENED.sections.firewall);
    const state = reduce(rechecking, { type: "recheck_done", state: next, report: REPORT_B });
    expect(state).toEqual({ kind: "ready", report: REPORT_B, state: next, explain: { kind: "off" } });
  });

  it("rechecking -> ready on recheck_failed with the previous report", () => {
    const rechecking = reduce(ready(), { type: "recheck_started", key: "firewall" });
    const state = reduce(rechecking, { type: "recheck_failed" });
    expect(state).toEqual({ kind: "ready", report: REPORT_A, state: DEV_MACHINE, explain: { kind: "off" } });
  });

  it("recheck_done outside rechecking is ignored", () => {
    const state = ready();
    expect(reduce(state, { type: "recheck_done", state: DEV_MACHINE, report: REPORT_B })).toBe(state);
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
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "running", target: "TL-MAC-001" });
    const order: RuleId[] = ["TL-MAC-001", "TL-MAC-002"];
    state = reduce(state, { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order });
    expect(state.kind === "ready" && state.explain).toEqual({
      kind: "ready",
      byRule: { "TL-MAC-001": EXPLANATION },
      order,
    });
    expect(state.kind === "ready" && state.report).toBe(REPORT_A);
  });

  it("explain: prioritise target and failure", () => {
    let state = reduce(ready(), { type: "explain_started", target: "prioritise" });
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "running", target: "prioritise" });
    state = reduce(state, { type: "explain_failed", reason: "no_api_key" });
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "failed", reason: "no_api_key" });
  });

  it("explain actions outside ready are ignored", () => {
    const c = collecting();
    expect(reduce(c, { type: "explain_started", target: "prioritise" })).toBe(c);
    expect(reduce(c, { type: "explain_ready", byRule: {}, order: null })).toBe(c);
    expect(reduce(c, { type: "explain_failed", reason: "unknown" })).toBe(c);
  });

  it("explain state is reset by a recheck", () => {
    let state = reduce(ready(), { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order: null });
    state = reduce(state, { type: "recheck_started", key: "firewall" });
    state = reduce(state, { type: "recheck_done", state: DEV_MACHINE, report: REPORT_B });
    expect(state.kind === "ready" && state.explain).toEqual({ kind: "off" });
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
