import { describe, expect, it } from "vitest";
import type { Explanation, FixPlan, RuleId } from "@talos/core";
import { DEV_MACHINE, HARDENED, MACOS_CATALOG, SECTION_KEYS, evaluate } from "@talos/core";
import { fakePlan } from "../app/testing";
import { emptyPlan, initialScanState, lastReport, reduce, replaceSection, rulePasses } from "./machine";
import type { ReadyState, ScanState } from "./machine";

const NOW = "2026-10-15T10:00:00.000Z";
const REPORT = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });
const FIXED_STATE = replaceSection(DEV_MACHINE, "firewall", HARDENED.sections.firewall);
const FIXED = evaluate(FIXED_STATE, MACOS_CATALOG, { now: NOW, os: "macos" });
const EXPLANATION: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "why", whatCouldHappen: "what", urgency: "today" };
const EMPTY = { byRule: {}, order: null, priority: null };

function presenting(previous: ScanState = initialScanState): ScanState {
  let s = reduce(previous, { type: "scan_started", startedAt: NOW });
  s = reduce(s, { type: "collected", state: DEV_MACHINE });
  return reduce(s, { type: "evaluated", report: REPORT });
}

function ready(): ReadyState {
  const s = reduce(presenting(), { type: "presented" });
  if (s.kind !== "ready") throw new Error("expected ready");
  return s;
}

describe("presenting", () => {
  it("evaluated lands in presenting with no rows revealed and the previous state carried", () => {
    const s = presenting();
    expect(s).toEqual({ kind: "presenting", report: REPORT, state: DEV_MACHINE, revealed: 0, phase: "areas", previous: null });
    expect(lastReport(s)).toBeNull();
  });

  it("row_revealed counts up to 17, preparing fills the rows, presented reaches ready", () => {
    let s = presenting();
    for (let i = 0; i < 20; i += 1) s = reduce(s, { type: "row_revealed" });
    expect(s.kind === "presenting" && s.revealed).toBe(SECTION_KEYS.length);
    s = reduce(s, { type: "preparing" });
    expect(s.kind === "presenting" && s.phase).toBe("preparing");
    s = reduce(s, { type: "presented" });
    expect(s).toEqual({ kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null });
  });

  it("presentation_cancelled hands previous back with its explain state intact, or idle on a first run", () => {
    const before: ReadyState = { ...ready(), explain: { kind: "ready", byRule: { "TL-MAC-001": EXPLANATION }, order: ["TL-MAC-001"], priority: null } };
    const cancelled = reduce(presenting(before), { type: "presentation_cancelled" });
    expect(cancelled).toEqual(before);
    expect(reduce(presenting(), { type: "presentation_cancelled" })).toEqual({ kind: "idle", last: null });
  });

  it("a rescan is ignored while presenting, and a rescan from ready clears any fix or watch", () => {
    const p = presenting();
    expect(reduce(p, { type: "scan_started", startedAt: NOW })).toBe(p);
    let r: ScanState = reduce(ready(), { type: "fix_previewed", plan: fakePlan() });
    r = reduce(r, { type: "watch_started", ruleId: "TL-MAC-001", sections: ["diskEncryption"], everyMs: 3000, startedAt: NOW });
    const c = reduce(r, { type: "scan_started", startedAt: NOW });
    expect(c.kind === "collecting" && c.previous?.fixing).toBeNull();
    expect(c.kind === "collecting" && c.previous?.watching).toBeNull();
  });
});

describe("fixing", () => {
  const plan: FixPlan = fakePlan({ ruleId: "TL-MAC-002", recheck: ["firewall"] });

  it("fix_previewed opens the confirm phase with the plan's line count", () => {
    const s = reduce(ready(), { type: "fix_previewed", plan });
    expect(s.kind === "ready" && s.fixing).toEqual({ kind: "single", plan, phase: "confirm", step: 0, of: 1, error: null, result: null });
  });

  it("fix_preview_failed opens straight on the error with an empty plan", () => {
    const s = reduce(ready(), { type: "fix_preview_failed", ruleId: "TL-MAC-002", error: "not_in_catalog" });
    expect(s.kind === "ready" && s.fixing).toEqual({ kind: "single", plan: emptyPlan("TL-MAC-002"), phase: "failed", step: 0, of: 0, error: "not_in_catalog", result: null });
  });

  it("progress, rechecking and done replace the report and keep surviving explanations, with no rechecking state", () => {
    let s = reduce(ready(), { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order: ["TL-MAC-001"] });
    s = reduce(s, { type: "fix_previewed", plan });
    s = reduce(s, { type: "fix_progress", phase: "waiting_for_password", step: 1, of: 1 });
    expect(s.kind === "ready" && s.fixing?.phase).toBe("waiting_for_password");
    s = reduce(s, { type: "fix_progress", phase: "running", step: 1, of: 1 });
    s = reduce(s, { type: "fix_rechecking" });
    expect(s.kind === "ready" && s.fixing?.phase).toBe("rechecking");
    s = reduce(s, { type: "fix_done", state: FIXED_STATE, report: FIXED, result: "pass", byRule: { "TL-MAC-001": EXPLANATION } });
    expect(s.kind).toBe("ready");
    if (s.kind !== "ready") return;
    expect(s.report).toBe(FIXED);
    expect(s.fixing).toEqual({ kind: "single", plan, phase: "done", step: 1, of: 1, error: null, result: "pass" });
    expect(s.explain).toEqual({ kind: "ready", byRule: { "TL-MAC-001": EXPLANATION }, order: null, priority: null });
    expect(rulePasses(FIXED, "TL-MAC-002")).toBe(true);
    expect(rulePasses(REPORT, "TL-MAC-002")).toBe(false);
  });

  it("fix_failed records the error and step; fix_dismissed clears the sub-state", () => {
    let s = reduce(ready(), { type: "fix_previewed", plan });
    s = reduce(s, { type: "fix_failed", error: "wrong_password", step: 1 });
    expect(s.kind === "ready" && s.fixing).toMatchObject({ phase: "failed", error: "wrong_password", step: 1 });
    s = reduce(s, { type: "fix_dismissed" });
    expect(s.kind === "ready" && s.fixing).toBeNull();
  });

  it("fix actions outside ready, or without a plan, are ignored", () => {
    const p = presenting();
    expect(reduce(p, { type: "fix_progress", phase: "running", step: 1, of: 1 })).toBe(p);
    const r = ready();
    expect(reduce(r, { type: "fix_failed", error: "busy", step: null })).toBe(r);
  });
});

describe("watching", () => {
  it("watch_started, watch_tick, watch_passed and watch_stopped", () => {
    let s = reduce(ready(), { type: "watch_started", ruleId: "TL-MAC-002", sections: ["firewall"], everyMs: 3000, startedAt: NOW });
    expect(s.kind === "ready" && s.watching).toEqual({ ruleId: "TL-MAC-002", sections: ["firewall"], everyMs: 3000, startedAt: NOW, lastPollAt: null, passedAt: null });
    s = reduce(s, { type: "watch_tick", state: FIXED_STATE, report: FIXED, at: NOW, byRule: {} });
    expect(s.kind === "ready" && s.report).toBe(FIXED);
    expect(s.kind === "ready" && s.watching?.lastPollAt).toBe(NOW);
    s = reduce(s, { type: "watch_passed", at: NOW });
    expect(s.kind === "ready" && s.watching?.passedAt).toBe(NOW);
    s = reduce(s, { type: "watch_stopped" });
    expect(s.kind === "ready" && s.watching).toBeNull();
  });

  it("a recheck keeps the watcher across rechecking and back", () => {
    let s = reduce(ready(), { type: "watch_started", ruleId: "TL-MAC-002", sections: ["firewall"], everyMs: 3000, startedAt: NOW });
    s = reduce(s, { type: "recheck_started", key: "ssh" });
    expect(s.kind === "rechecking" && s.watching?.ruleId).toBe("TL-MAC-002");
    s = reduce(s, { type: "recheck_done", state: DEV_MACHINE, report: REPORT, byRule: {} });
    expect(s.kind === "ready" && s.watching?.ruleId).toBe("TL-MAC-002");
  });
});

describe("explain streaming", () => {
  it("explain_partial fills the running target only; explain_cancelled returns to what was shown, never failed", () => {
    const shown = reduce(ready(), { type: "explain_ready", byRule: { "TL-MAC-001": EXPLANATION }, order: null });
    let s = reduce(shown, { type: "explain_started", target: "TL-MAC-002" });
    s = reduce(s, { type: "explain_partial", target: "TL-MAC-001", partial: { whyItMattersForYou: "x" } });
    expect(s.kind === "ready" && s.explain.kind === "running" && s.explain.partial).toBeNull();
    s = reduce(s, { type: "explain_partial", target: "TL-MAC-002", partial: { whyItMattersForYou: "x" } });
    expect(s.kind === "ready" && s.explain.kind === "running" && s.explain.partial).toEqual({ whyItMattersForYou: "x" });
    s = reduce(s, { type: "explain_cancelled" });
    expect(s.kind === "ready" && s.explain).toEqual({ kind: "ready", byRule: { "TL-MAC-001": EXPLANATION }, order: null, priority: null });
    const off = reduce(reduce(ready(), { type: "explain_started", target: "prioritise" }), { type: "explain_cancelled" });
    expect(off.kind === "ready" && off.explain).toEqual({ kind: "off" });
    expect(reduce(ready(), { type: "explain_cancelled" })).toEqual(ready());
  });

  it("ask_partial and ask_done act only on a running ask", () => {
    const other = reduce(ready(), { type: "explain_started", target: "prioritise" });
    expect(reduce(other, { type: "ask_partial", answerPartial: "x" })).toBe(other);
    expect(reduce(other, { type: "ask_done" })).toBe(other);
    let s = reduce(ready(), { type: "explain_started", target: "ask" });
    expect(s.kind === "ready" && s.explain).toEqual({ kind: "running", target: "ask", partial: null, answerPartial: null, from: EMPTY });
    s = reduce(s, { type: "ask_partial", answerPartial: "Start with" });
    expect(s.kind === "ready" && s.explain.kind === "running" && s.explain.answerPartial).toBe("Start with");
    s = reduce(s, { type: "ask_done" });
    expect(s.kind === "ready" && s.explain).toEqual({ kind: "off" });
  });

  it("explain_ready keeps the prioritisation next to the order", () => {
    const order: RuleId[] = ["TL-MAC-002", "TL-MAC-001"];
    const priority = { order, reasons: [], startWith: ["TL-MAC-002" as RuleId] };
    const s = reduce(ready(), { type: "explain_ready", byRule: {}, order, priority });
    expect(s.kind === "ready" && s.explain).toEqual({ kind: "ready", byRule: {}, order, priority });
  });
});
