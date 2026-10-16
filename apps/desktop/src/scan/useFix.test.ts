import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { FixError, FixOutcome, FixPlan, ScanReport, SystemState } from "@talos/core";
import { DEV_MACHINE, HARDENED, MACOS_CATALOG, evaluate } from "@talos/core";
import { fakeAdapters, fakeFixPort, fakePlan, fakeSystemState, noExplainer } from "../app/testing";
import { AWAY_GRACE_MS } from "./awayPolling";
import { useScan } from "./useScan";
import type { ScanDeps } from "./useScan";

const NOW = "2026-10-15T10:00:00.000Z";
const FIXED: SystemState = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } };
const PLAN: FixPlan = fakePlan({ ruleId: "TL-MAC-002", recheck: ["firewall"] });
const ERRORS: readonly FixError[] = ["cancelled", "wrong_password", "command_failed", "timeout", "plan_expired", "precondition_changed", "not_in_catalog", "invalid_choice", "invalid_input", "busy"];

function engine(state: SystemState): ScanReport {
  return evaluate(state, MACOS_CATALOG, { now: NOW, os: "macos" });
}

/** A hook at ready on the dev machine; rechecks read from `after`. */
async function readyHook(options: { apply?: (planId: string, input: unknown, opts?: { signal?: AbortSignal }) => Promise<FixOutcome>; after?: SystemState; unreadable?: boolean } = {}) {
  const after = options.after ?? DEV_MACHINE;
  const systemState = fakeSystemState(DEV_MACHINE, options.unreadable === true ? { collectSection: vi.fn(async () => { throw new Error("boom"); }) } : {}, after);
  const fixes = fakeFixPort(PLAN, options.apply === undefined ? {} : { apply: vi.fn(options.apply) as never });
  const adapters = fakeAdapters({ systemState, fixes });
  const deps: ScanDeps = { adapters, engine, createExplainer: async () => noExplainer, toContext: () => ({ schemaVersion: 1, os: "macos", osVersion: "27", profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true }, score: 0, counts: { pass: 0, fail: 0, review: 0, unknown: 0, not_applicable: 0 }, findings: [] }) };
  const hook = renderHook(() => useScan(deps));
  await act(async () => {
    await hook.result.current.start();
    await hook.result.current.present();
  });
  return { hook, adapters, fixes };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useScan fix actions", () => {
  it("previewFix stores the plan in confirm; a preview rejection opens on the error", async () => {
    const { hook, fixes } = await readyHook();
    await act(async () => {
      await hook.result.current.previewFix("TL-MAC-002", { kind: "none" });
    });
    expect(fixes.preview).toHaveBeenCalledWith("TL-MAC-002", { kind: "none" });
    const s = hook.result.current.scan;
    expect(s.kind === "ready" && s.fixing).toMatchObject({ plan: PLAN, phase: "confirm" });
    const rejecting = await readyHook();
    vi.mocked(rejecting.fixes.preview).mockRejectedValueOnce("invalid_choice");
    await act(async () => {
      await rejecting.hook.result.current.previewFix("TL-MAC-002", { kind: "share", path: "/x" });
    });
    const r = rejecting.hook.result.current.scan;
    expect(r.kind === "ready" && r.fixing).toMatchObject({ phase: "failed", error: "invalid_choice", step: 0 });
  });

  it("applyFix passes progress through, rechecks, and lands on pass with the new report saved", async () => {
    const apply = async (_id: string, _input: unknown, opts?: { onProgress?: (p: unknown) => void }) => {
      opts?.onProgress?.({ planId: PLAN.planId, phase: "waiting_for_password", step: 1, of: 1 });
      opts?.onProgress?.({ planId: PLAN.planId, phase: "running", step: 1, of: 1 });
      return { ok: true as const };
    };
    const { hook, adapters } = await readyHook({ apply: apply as never, after: FIXED });
    await act(async () => {
      await hook.result.current.previewFix("TL-MAC-002", { kind: "none" });
    });
    await act(async () => {
      await hook.result.current.applyFix();
    });
    const s = hook.result.current.scan;
    expect(s.kind).toBe("ready");
    if (s.kind !== "ready") return;
    expect(s.fixing).toMatchObject({ phase: "done", result: "pass", error: null });
    expect(s.report.findings.some((f) => f.ruleId === "TL-MAC-002")).toBe(false);
    expect(adapters.reports.saveLast).toHaveBeenLastCalledWith(s.report);
    expect(adapters.systemState.collectSection).toHaveBeenCalledWith("firewall");
  });

  it("reports still_failing when the recheck keeps the finding, and unreadable when the section cannot be read", async () => {
    const same = await readyHook({ after: DEV_MACHINE });
    await act(async () => {
      await same.hook.result.current.previewFix("TL-MAC-002", { kind: "none" });
      await same.hook.result.current.applyFix();
    });
    const a = same.hook.result.current.scan;
    expect(a.kind === "ready" && a.fixing?.result).toBe("still_failing");
    const broken = await readyHook({ unreadable: true });
    await act(async () => {
      await broken.hook.result.current.previewFix("TL-MAC-002", { kind: "none" });
      await broken.hook.result.current.applyFix();
    });
    const b = broken.hook.result.current.scan;
    expect(b.kind === "ready" && b.fixing?.result).toBe("unreadable");
    expect(b.kind === "ready" && b.report.findings.some((f) => f.ruleId === "TL-MAC-002")).toBe(true);
  });

  it.each(ERRORS)("lands in failed with %s from the resolved channel", async (error) => {
    const { hook } = await readyHook({ apply: async () => ({ ok: false, error, step: 1 }) });
    await act(async () => {
      await hook.result.current.previewFix("TL-MAC-002", { kind: "none" });
      await hook.result.current.applyFix("secret-passphrase");
    });
    const s = hook.result.current.scan;
    expect(s.kind === "ready" && s.fixing).toMatchObject({ phase: "failed", error, step: 1 });
  });

  it("a pre-run rejection folded by the port arrives with no step", async () => {
    const { hook } = await readyHook({ apply: async () => ({ ok: false, error: "plan_expired", step: null }) });
    await act(async () => {
      await hook.result.current.previewFix("TL-MAC-002", { kind: "none" });
      await hook.result.current.applyFix();
    });
    const s = hook.result.current.scan;
    expect(s.kind === "ready" && s.fixing).toMatchObject({ phase: "failed", error: "plan_expired", step: 1 });
  });

  it("cancelFix aborts a running apply, dismisses a settled sheet, and passes the passphrase through", async () => {
    let signal: AbortSignal | undefined;
    const apply = vi.fn((_id: string, _input: unknown, opts?: { signal?: AbortSignal }) =>
      new Promise<FixOutcome>((resolve) => {
        signal = opts?.signal;
        signal?.addEventListener("abort", () => resolve({ ok: false, error: "cancelled", step: 1 }));
      }),
    );
    const { hook } = await readyHook({ apply });
    await act(async () => {
      await hook.result.current.previewFix("TL-MAC-002", { kind: "none" });
    });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = hook.result.current.applyFix("pass phrase 1234");
    });
    expect(apply).toHaveBeenCalledWith(PLAN.planId, { passphrase: "pass phrase 1234" }, expect.anything());
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.fixing?.phase).toBe("waiting_for_password");
    act(() => hook.result.current.cancelFix());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      await pending;
    });
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.fixing?.error).toBe("cancelled");
    act(() => hook.result.current.cancelFix());
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.fixing).toBeNull();
  });
});

describe("useScan watch actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });

  it("startWatch polls the rule's watch sections while unfocused and marks it passed, then stops", async () => {
    const { hook, adapters } = await readyHook({ after: HARDENED });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    act(() => hook.result.current.startWatch("TL-MAC-001"));
    const s = hook.result.current.scan;
    expect(s.kind === "ready" && s.watching).toMatchObject({ ruleId: "TL-MAC-001", sections: ["diskEncryption"] });
    const every = s.kind === "ready" ? (s.watching?.everyMs ?? 0) : 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(every);
    });
    const after = hook.result.current.scan;
    expect(after.kind === "ready" && after.watching?.passedAt).toBe(NOW);
    expect(after.kind === "ready" && after.report.findings.some((f) => f.ruleId === "TL-MAC-001")).toBe(false);
    expect(adapters.reports.saveLast).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(adapters.systemState.collectSection).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(every * 3);
    });
    expect(vi.mocked(adapters.systemState.collectSection).mock.calls.length).toBe(calls);
  });

  it("the watcher pauses after the grace period with focus back, and stopWatch clears it", async () => {
    const { hook, adapters } = await readyHook({ after: DEV_MACHINE });
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    act(() => hook.result.current.startWatch("TL-MAC-001"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AWAY_GRACE_MS + 5000);
    });
    const polled = vi.mocked(adapters.systemState.collectSection).mock.calls.length;
    expect(polled).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(vi.mocked(adapters.systemState.collectSection).mock.calls.length).toBeLessThanOrEqual(polled + 1);
    act(() => hook.result.current.stopWatch());
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.watching).toBeNull();
  });

  it("reveal calls the port then starts the watcher; a rescan clears the watch", async () => {
    const { hook, fixes } = await readyHook();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await act(async () => {
      await hook.result.current.reveal("TL-MAC-023", { kind: "plist", path: "/Library/LaunchAgents/x.plist" });
    });
    expect(fixes.reveal).toHaveBeenCalledWith("TL-MAC-023", { kind: "plist", path: "/Library/LaunchAgents/x.plist" });
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.watching?.ruleId).toBe("TL-MAC-023");
    await act(async () => {
      await hook.result.current.start();
      await hook.result.current.present();
    });
    expect(hook.result.current.scan.kind === "ready" && hook.result.current.scan.watching).toBeNull();
  });
});
