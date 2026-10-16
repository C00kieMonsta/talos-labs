import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { BatchOutcome, BatchPlan, FixError, FixProgress, ScanReport, SystemState } from "@talos/core";
import { DEV_MACHINE, HARDENED, MACOS_CATALOG, evaluate } from "@talos/core";
import { fakeAdapters, fakeBatchPlan, fakeFixPort, fakeSystemState, noExplainer } from "../app/testing";
import { useScan } from "./useScan";
import type { ScanDeps } from "./useScan";

const NOW = "2026-10-15T10:00:00.000Z";
const FIXED: SystemState = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } };
const PLAN = fakeBatchPlan();
const IDS = ["TL-MAC-002", "TL-MAC-003"] as const;
const ERRORS: readonly FixError[] = ["cancelled", "wrong_password", "command_failed", "timeout", "plan_expired", "precondition_changed", "not_in_catalog", "invalid_choice", "invalid_input", "busy"];

function engine(state: SystemState): ScanReport {
  return evaluate(state, MACOS_CATALOG, { now: NOW, os: "macos" });
}

type ApplyBatch = (planId: string, opts?: { signal?: AbortSignal; onProgress?: (p: FixProgress) => void }) => Promise<BatchOutcome>;

async function readyHook(options: { applyBatch?: ApplyBatch; plan?: BatchPlan; after?: SystemState; unreadable?: boolean } = {}) {
  const after = options.after ?? DEV_MACHINE;
  const systemState = fakeSystemState(DEV_MACHINE, options.unreadable === true ? { collectSection: vi.fn(async () => { throw new Error("boom"); }) } : {}, after);
  const fixes = fakeFixPort(undefined, {
    previewBatch: vi.fn(async () => options.plan ?? PLAN),
    ...(options.applyBatch === undefined ? {} : { applyBatch: vi.fn(options.applyBatch) as never }),
  });
  const adapters = fakeAdapters({ systemState, fixes });
  const deps: ScanDeps = { adapters, engine, createExplainer: async () => noExplainer, toContext: () => ({ schemaVersion: 1, os: "macos", osVersion: "27", profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true }, score: 0, counts: { pass: 0, fail: 0, review: 0, unknown: 0, not_applicable: 0 }, findings: [] }) };
  const hook = renderHook(() => useScan(deps));
  await act(async () => {
    await hook.result.current.start();
    await hook.result.current.present();
  });
  return { hook, adapters, fixes };
}

function fixing(hook: Awaited<ReturnType<typeof readyHook>>["hook"]) {
  const s = hook.result.current.scan;
  return s.kind === "ready" ? s.fixing : null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useScan batch actions", () => {
  it("previewBatch stores the batch plan in confirm; a refusal lands in a failed single sheet on the first id", async () => {
    const { hook, fixes } = await readyHook();
    await act(async () => {
      await hook.result.current.previewBatch(IDS);
    });
    expect(fixes.previewBatch).toHaveBeenCalledWith(IDS);
    expect(fixing(hook)).toMatchObject({ kind: "batch", plan: PLAN, phase: "confirm", of: 2, item: null });
    const rejecting = await readyHook();
    vi.mocked(rejecting.fixes.previewBatch).mockRejectedValueOnce("invalid_choice");
    await act(async () => {
      await rejecting.hook.result.current.previewBatch(IDS);
    });
    expect(fixing(rejecting.hook)).toMatchObject({ kind: "single", phase: "failed", error: "invalid_choice", plan: { ruleId: "TL-MAC-002" } });
  });

  it("applyBatch passes progress with item through, rechecks the union once, and lands on done with every verdict and the report saved", async () => {
    const applyBatch: ApplyBatch = async (planId, opts) => {
      opts?.onProgress?.({ planId, phase: "waiting_for_password", step: 1, of: 1 });
      opts?.onProgress?.({ planId, phase: "running", step: 1, of: 1, item: 1 });
      return { ok: true, items: [{ ruleId: "TL-MAC-002", status: "done", error: null, step: null }, { ruleId: "TL-MAC-003", status: "done", error: null, step: null }], error: null };
    };
    const { hook, adapters, fixes } = await readyHook({ applyBatch, after: FIXED });
    await act(async () => {
      await hook.result.current.previewBatch(IDS);
      await hook.result.current.applyBatch();
    });
    expect(fixes.applyBatch).toHaveBeenCalledWith(PLAN.planId, expect.objectContaining({ signal: expect.anything() }));
    expect(vi.mocked(adapters.systemState.collectSection)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(adapters.systemState.collectSection)).toHaveBeenCalledWith("firewall");
    expect(fixing(hook)).toMatchObject({ kind: "batch", phase: "done", item: 1, error: null, byRule: { "TL-MAC-002": "pass", "TL-MAC-003": "pass" } });
    expect(adapters.reports.saveLast).toHaveBeenCalledTimes(2);
    const s = hook.result.current.scan;
    expect(s.kind === "ready" && s.report.findings.some((f) => f.ruleId === "TL-MAC-002")).toBe(false);
  });

  it.each(ERRORS)("a %s outcome still rechecks and lands on failed with that error and the per-item verdicts", async (error) => {
    const applyBatch: ApplyBatch = async () => ({ ok: false, items: [], error });
    const { hook, adapters } = await readyHook({ applyBatch });
    await act(async () => {
      await hook.result.current.previewBatch(IDS);
      await hook.result.current.applyBatch();
    });
    expect(vi.mocked(adapters.systemState.collectSection)).toHaveBeenCalledTimes(1);
    expect(fixing(hook)).toMatchObject({ kind: "batch", phase: "failed", error, outcome: { ok: false, error }, byRule: { "TL-MAC-002": "still_failing", "TL-MAC-003": "still_failing" } });
    expect(adapters.reports.saveLast).toHaveBeenCalledTimes(2);
  });

  it("a partial outcome keeps the item rows and the recheck tells which item took", async () => {
    const partial: BatchOutcome = {
      ok: false,
      items: [{ ruleId: "TL-MAC-002", status: "done", error: null, step: null }, { ruleId: "TL-MAC-003", status: "failed", error: "command_failed", step: 0 }],
      error: null,
    };
    const { hook } = await readyHook({ applyBatch: async () => partial, after: FIXED });
    await act(async () => {
      await hook.result.current.previewBatch(IDS);
      await hook.result.current.applyBatch();
    });
    // HARDENED's firewall passes both firewall rules, so the recheck wins over the failed row.
    expect(fixing(hook)).toMatchObject({ phase: "failed", error: null, outcome: partial, byRule: { "TL-MAC-002": "pass", "TL-MAC-003": "pass" } });
  });

  it("an excluded item gets no verdict and is not rechecked", async () => {
    const plan = fakeBatchPlan({ items: [PLAN.items[0]!], excluded: [{ ruleId: "TL-MAC-003", error: "precondition_changed" }] });
    const { hook } = await readyHook({ plan, after: FIXED });
    await act(async () => {
      await hook.result.current.previewBatch(IDS);
      await hook.result.current.applyBatch();
    });
    const f = fixing(hook);
    expect(f?.kind === "batch" && f.plan.excluded).toEqual([{ ruleId: "TL-MAC-003", error: "precondition_changed" }]);
    expect(f?.kind === "batch" && f.byRule).toEqual({ "TL-MAC-002": "pass" });
  });

  it("the three recheck verdicts: still_failing on an unchanged section and unreadable when it cannot be read", async () => {
    const same = await readyHook({ after: DEV_MACHINE });
    await act(async () => {
      await same.hook.result.current.previewBatch(IDS);
      await same.hook.result.current.applyBatch();
    });
    expect(fixing(same.hook)).toMatchObject({ phase: "done", byRule: { "TL-MAC-002": "still_failing", "TL-MAC-003": "still_failing" } });
    const broken = await readyHook({ unreadable: true });
    await act(async () => {
      await broken.hook.result.current.previewBatch(IDS);
      await broken.hook.result.current.applyBatch();
    });
    expect(fixing(broken.hook)).toMatchObject({ phase: "done", byRule: { "TL-MAC-002": "unreadable", "TL-MAC-003": "unreadable" } });
  });

  it("a port that throws is folded into command_failed; applyBatch outside confirm or on a single plan is ignored", async () => {
    const { hook, fixes } = await readyHook({ applyBatch: async () => { throw new Error("boom"); } });
    await act(async () => {
      await hook.result.current.applyBatch();
    });
    expect(fixes.applyBatch).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.previewFix("TL-MAC-002", { kind: "none" });
      await hook.result.current.applyBatch();
    });
    expect(fixes.applyBatch).not.toHaveBeenCalled();
    await act(async () => {
      await hook.result.current.previewBatch(IDS);
      await hook.result.current.applyBatch();
    });
    expect(fixing(hook)).toMatchObject({ kind: "batch", phase: "failed", error: "command_failed", outcome: { items: [] } });
  });

  it("cancelFix aborts a running batch", async () => {
    let signal: AbortSignal | undefined;
    const applyBatch: ApplyBatch = (_id, opts) =>
      new Promise((resolve) => {
        signal = opts?.signal;
        signal?.addEventListener("abort", () => resolve({ ok: false, items: [], error: "cancelled" }));
      });
    const { hook } = await readyHook({ applyBatch });
    await act(async () => {
      await hook.result.current.previewBatch(IDS);
    });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = hook.result.current.applyBatch();
    });
    expect(fixing(hook)).toMatchObject({ phase: "waiting_for_password", item: null });
    act(() => hook.result.current.cancelFix());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      await pending;
    });
    expect(fixing(hook)).toMatchObject({ phase: "failed", error: "cancelled" });
  });
});

describe("startWatch with a watch argument", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  it("polls the given sections for an in_app rule, which the bare call refuses", async () => {
    const { hook, adapters } = await readyHook({ after: FIXED });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => hook.result.current.startWatch("TL-MAC-002"));
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.watching).toBeNull();
    act(() => hook.result.current.startWatch("TL-MAC-002", { sections: ["firewall"], everyMs: 3000 }));
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.watching).toMatchObject({ ruleId: "TL-MAC-002", sections: ["firewall"], everyMs: 3000 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(vi.mocked(adapters.systemState.collectSection)).toHaveBeenCalledWith("firewall");
    const s = hook.result.current.scan;
    expect(s.kind === "ready" && s.watching?.passedAt).toBe(NOW);
    expect(s.kind === "ready" && s.report.findings.some((f) => f.ruleId === "TL-MAC-002")).toBe(false);
  });

  it("falls back to the default interval for a zero everyMs and refuses an empty section list", async () => {
    const { hook } = await readyHook();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => hook.result.current.startWatch("TL-MAC-002", { sections: [], everyMs: 1000 }));
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.watching).toBeNull();
    act(() => hook.result.current.startWatch("TL-MAC-002", { sections: ["firewall"], everyMs: 0 }));
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.watching?.everyMs).toBe(3000);
  });
});
