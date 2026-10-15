import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CollectOptions, ScanReport, SystemState } from "@talos/core";
import { DEV_MACHINE, HARDENED, SECTION_KEYS } from "@talos/core";
import { classifyScanError, useScan } from "./useScan";
import type { ScanDeps } from "./useScan";
import { fakeAdapters, fakeSystemState, noExplainer } from "../app/testing";

afterEach(cleanup);

function fakeEngine(state: SystemState): ScanReport {
  const sections = {} as Record<(typeof SECTION_KEYS)[number], { status: "ok" }>;
  for (const key of SECTION_KEYS) sections[key] = { status: "ok" };
  const encrypted = state.sections.diskEncryption.status === "ok" && state.sections.diskEncryption.data.systemVolumeEncrypted;
  return {
    schemaVersion: 1,
    reportId: encrypted ? "encrypted" : "unencrypted",
    scannedAt: "2026-10-15T10:00:00.000Z",
    collectedAt: state.collectedAt,
    coreVersion: "0.1.0",
    catalogVersion: "0.1.0",
    cisEdition: "test",
    platform: state.host,
    sections,
    score: { value: encrypted ? 100 : 80, grade: encrypted ? "good" : "fair", deducted: 0, cappedByCritical: false, complete: true, counts: { pass: 0, fail: 0, review: 0, unknown: 0, not_applicable: 0 } },
    results: [],
    findings: [],
  };
}

function deps(adaptersOverride: Partial<ReturnType<typeof fakeAdapters>> = {}): ScanDeps {
  const adapters = fakeAdapters(adaptersOverride);
  return {
    adapters,
    engine: fakeEngine,
    createExplainer: async () => noExplainer,
    toContext: () => ({
      schemaVersion: 1,
      os: "macos",
      osVersion: "27.0.1",
      profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true },
      score: 80,
      counts: { pass: 0, fail: 0, review: 0, unknown: 0, not_applicable: 0 },
      findings: [],
    }),
  };
}

describe("useScan", () => {
  it("collects, evaluates, reaches ready and saves the report", async () => {
    const d = deps();
    const { result } = renderHook(() => useScan(d));
    expect(result.current.scan.kind).toBe("idle");
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.scan.kind).toBe("ready");
    if (result.current.scan.kind !== "ready") return;
    expect(result.current.scan.report.reportId).toBe("unencrypted");
    expect(result.current.scan.state).toBe(DEV_MACHINE);
    expect(d.adapters.reports.saveLast).toHaveBeenCalledWith(result.current.scan.report);
  });

  it("forwards progress events into the collecting state", async () => {
    let release: () => void = () => undefined;
    const collect = (options?: CollectOptions) =>
      new Promise<SystemState>((resolve) => {
        options?.onProgress?.({ key: "firewall", status: "ok" });
        release = () => resolve(DEV_MACHINE);
      });
    const d = deps({ systemState: fakeSystemState(DEV_MACHINE, { collect }) });
    const { result } = renderHook(() => useScan(d));
    act(() => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.scan.kind).toBe("collecting"));
    expect(result.current.scan.kind === "collecting" && result.current.scan.sections.firewall).toBe("ok");
    await act(async () => {
      release();
    });
    await waitFor(() => expect(result.current.scan.kind).toBe("ready"));
  });

  it("cancel aborts the signal and lands in failed with cancelled, keeping the last report", async () => {
    const previous = fakeEngine(HARDENED);
    const collect = (options?: CollectOptions) =>
      new Promise<SystemState>((_, reject) => {
        options?.signal?.addEventListener("abort", () => reject("cancelled"));
      });
    const d = deps({
      systemState: fakeSystemState(DEV_MACHINE, { collect }),
      reports: { saveLast: vi.fn(async () => undefined), loadLast: vi.fn(async () => previous) },
    });
    const { result } = renderHook(() => useScan(d));
    await act(async () => {
      await result.current.loadLast();
    });
    expect(result.current.scan).toEqual({ kind: "idle", last: previous });
    act(() => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.scan.kind).toBe("collecting"));
    await act(async () => {
      result.current.cancel();
    });
    await waitFor(() => expect(result.current.scan.kind).toBe("failed"));
    expect(result.current.scan).toEqual({ kind: "failed", error: "cancelled", last: previous });
  });

  it("recheck replaces one section, re-runs the engine and returns to ready", async () => {
    const d = deps({ systemState: fakeSystemState(DEV_MACHINE, {}, HARDENED) });
    const collectSection = d.adapters.systemState.collectSection;
    const { result } = renderHook(() => useScan(d));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.scan.kind === "ready" && result.current.scan.report.reportId).toBe("unencrypted");
    await act(async () => {
      await result.current.recheck(["diskEncryption"]);
    });
    expect(collectSection).toHaveBeenCalledWith("diskEncryption");
    expect(result.current.scan.kind).toBe("ready");
    if (result.current.scan.kind !== "ready") return;
    expect(result.current.scan.report.reportId).toBe("encrypted");
    expect(result.current.scan.state.sections.diskEncryption).toBe(HARDENED.sections.diskEncryption);
    expect(result.current.scan.state.sections.ssh).toBe(DEV_MACHINE.sections.ssh);
  });

  it("a successful recheck records which section was checked and when", async () => {
    const d = deps({ systemState: fakeSystemState(DEV_MACHINE, {}, HARDENED) });
    const { result } = renderHook(() => useScan(d));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.scan.kind === "ready" && result.current.scan.lastRecheck).toBeNull();
    await act(async () => {
      await result.current.recheck(["ssh"]);
    });
    expect(result.current.scan.kind === "ready" && result.current.scan.lastRecheck).toEqual({
      key: "ssh",
      at: "2026-10-15T10:00:00.000Z",
    });
  });

  it("an explainer failure keeps earlier explanations and names the rule that failed", async () => {
    const explanation = { ruleId: "TL-MAC-001" as const, whyItMattersForYou: "why", whatCouldHappen: "what", urgency: "today" as const };
    const explainer = {
      ...noExplainer,
      explain: vi.fn(async ({ ruleId }: { ruleId: string }) =>
        ruleId === "TL-MAC-001" ? { ok: true as const, value: explanation } : { ok: false as const, reason: "timeout" as const },
      ),
    };
    const d = { ...deps(), createExplainer: async () => explainer };
    const { result } = renderHook(() => useScan(d));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.explain("TL-MAC-001");
    });
    await act(async () => {
      await result.current.explain("TL-MAC-002");
    });
    expect(result.current.scan.kind === "ready" && result.current.scan.explain).toEqual({
      kind: "failed",
      reason: "timeout",
      target: "TL-MAC-002",
      byRule: { "TL-MAC-001": explanation },
      order: null,
    });
  });

  it("a failed recheck returns to ready with the previous report and a notice", async () => {
    const collectSection = async () => {
      throw new Error("boom");
    };
    const d = deps({ systemState: fakeSystemState(DEV_MACHINE, { collectSection }) });
    const { result } = renderHook(() => useScan(d));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.recheck(["ssh"]);
    });
    expect(result.current.scan.kind).toBe("ready");
    expect(result.current.scan.kind === "ready" && result.current.scan.report.reportId).toBe("unencrypted");
    expect(result.current.notice).not.toBeNull();
  });

  it("maps collector errors", () => {
    expect(classifyScanError("cancelled", false, true)).toBe("cancelled");
    expect(classifyScanError(new Error("x"), true, true)).toBe("timeout");
    expect(classifyScanError("collector timed out", false, false)).toBe("timeout");
    expect(classifyScanError(new Error("SystemState schema mismatch at sections.ssh"), false, false)).toBe("schema_mismatch");
    expect(classifyScanError("segfault", false, false)).toBe("collector_crashed");
  });
});
