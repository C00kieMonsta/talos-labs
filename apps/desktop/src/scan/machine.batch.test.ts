import { describe, expect, it } from "vitest";
import type { BatchOutcome } from "@talos/core";
import { DEV_MACHINE, HARDENED, MACOS_CATALOG, SECTION_KEYS, evaluate } from "@talos/core";
import { fakeBatchPlan, fakePlan } from "../app/testing";
import { initialScanState, reduce, replaceSection } from "./machine";
import type { ReadyState, ScanState } from "./machine";

const NOW = "2026-10-15T10:00:00.000Z";
const REPORT = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });
const FIXED_STATE = replaceSection(DEV_MACHINE, "firewall", HARDENED.sections.firewall);
const FIXED = evaluate(FIXED_STATE, MACOS_CATALOG, { now: NOW, os: "macos" });
const PLAN = fakeBatchPlan();
const OK: BatchOutcome = {
  ok: true,
  items: [
    { ruleId: "TL-MAC-002", status: "done", error: null, step: null },
    { ruleId: "TL-MAC-003", status: "done", error: null, step: null },
  ],
  error: null,
};

function ready(): ReadyState {
  let s: ScanState = reduce(initialScanState, { type: "scan_started", startedAt: NOW });
  s = reduce(s, { type: "collected", state: DEV_MACHINE });
  s = reduce(s, { type: "evaluated", report: REPORT });
  for (const _ of SECTION_KEYS) s = reduce(s, { type: "row_revealed" });
  s = reduce(s, { type: "presented" });
  if (s.kind !== "ready") throw new Error("not ready");
  return s;
}

describe("batch fixing state", () => {
  it("batch_previewed opens the confirm phase with the total line count and no item", () => {
    const s = reduce(ready(), { type: "batch_previewed", plan: PLAN });
    expect(s.kind === "ready" && s.fixing).toEqual({ kind: "batch", plan: PLAN, phase: "confirm", step: 0, of: 2, item: null, error: null, outcome: null, byRule: {} });
  });

  it("fix_progress sets item on the batch variant and ignores it on the single one", () => {
    let s = reduce(ready(), { type: "batch_previewed", plan: PLAN });
    s = reduce(s, { type: "fix_progress", phase: "waiting_for_password", step: 1, of: 2, item: 1 });
    expect(s.kind === "ready" && s.fixing).toMatchObject({ kind: "batch", phase: "waiting_for_password", step: 1, item: 1 });
    s = reduce(s, { type: "fix_progress", phase: "running", step: 2, of: 2 });
    expect(s.kind === "ready" && s.fixing).toMatchObject({ phase: "running", step: 2, item: 1 });
    s = reduce(s, { type: "fix_progress", phase: "running", step: 2, of: 2, item: 2 });
    expect(s.kind === "ready" && s.fixing).toMatchObject({ item: 2 });
    let single = reduce(ready(), { type: "fix_previewed", plan: fakePlan() });
    single = reduce(single, { type: "fix_progress", phase: "running", step: 1, of: 1, item: 3 });
    expect(single.kind === "ready" && single.fixing).toEqual({ kind: "single", plan: fakePlan(), phase: "running", step: 1, of: 1, error: null, result: null });
  });

  it("batch_done lands on done with the verdicts and the new report; a failed outcome lands on failed with its error", () => {
    let s = reduce(ready(), { type: "batch_previewed", plan: PLAN });
    s = reduce(s, { type: "fix_rechecking" });
    expect(s.kind === "ready" && s.fixing?.phase).toBe("rechecking");
    const verdicts = { "TL-MAC-002": "pass" as const, "TL-MAC-003": "pass" as const };
    const done = reduce(s, { type: "batch_done", state: FIXED_STATE, report: FIXED, outcome: OK, byRule: {}, verdicts });
    expect(done.kind === "ready" && done.report).toBe(FIXED);
    expect(done.kind === "ready" && done.fixing).toMatchObject({ kind: "batch", phase: "done", error: null, outcome: OK, byRule: verdicts });
    const partial: BatchOutcome = { ok: false, items: [OK.items[0]!, { ruleId: "TL-MAC-003", status: "failed", error: "command_failed", step: 0 }], error: "command_failed" };
    const failed = reduce(s, { type: "batch_done", state: DEV_MACHINE, report: REPORT, outcome: partial, byRule: {}, verdicts: { "TL-MAC-002": "pass", "TL-MAC-003": "still_failing" } });
    expect(failed.kind === "ready" && failed.fixing).toMatchObject({ phase: "failed", error: "command_failed", outcome: partial });
  });

  it("the single and batch terminal actions ignore the other variant, and fix_dismissed clears a batch", () => {
    const batch = reduce(ready(), { type: "batch_previewed", plan: PLAN });
    expect(reduce(batch, { type: "fix_done", state: FIXED_STATE, report: FIXED, result: "pass", byRule: {} })).toBe(batch);
    const single = reduce(ready(), { type: "fix_previewed", plan: fakePlan() });
    expect(reduce(single, { type: "batch_done", state: FIXED_STATE, report: FIXED, outcome: OK, byRule: {}, verdicts: {} })).toBe(single);
    const r = ready();
    expect(reduce(r, { type: "batch_done", state: FIXED_STATE, report: FIXED, outcome: OK, byRule: {}, verdicts: {} })).toBe(r);
    const dismissed = reduce(batch, { type: "fix_dismissed" });
    expect(dismissed.kind === "ready" && dismissed.fixing).toBeNull();
    const failed = reduce(batch, { type: "fix_failed", error: "busy", step: null });
    expect(failed.kind === "ready" && failed.fixing).toMatchObject({ kind: "batch", phase: "failed", error: "busy" });
  });

  it("a rescan clears a batch in flight", () => {
    const batch = reduce(ready(), { type: "batch_previewed", plan: PLAN });
    const s = reduce(batch, { type: "scan_started", startedAt: NOW });
    expect(s.kind === "collecting" && s.previous?.fixing).toBeNull();
  });
});
