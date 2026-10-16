import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FixProgress } from "@talos/core";
import { MAX_BATCH_RULES, TauriFixAdapter, toBatchOutcome, toBatchPlan, toFixProgress } from "./tauri-fix";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
let handler: EventCallback<unknown> | null = null;
const unlisten = vi.fn<UnlistenFn>();

const WIRE = {
  planId: "b1",
  items: [
    { ruleId: "TL-MAC-002", lines: [{ text: "a", privilege: "admin" }], recheck: ["firewall"], previous: null },
    { ruleId: "TL-MAC-003", lines: [{ text: "b", privilege: "admin" }], recheck: ["firewall"], previous: null },
  ],
  excluded: [{ ruleId: "TL-MAC-011", error: "precondition_changed" }],
  needsPassword: true,
  recheck: ["firewall"],
  expiresAt: "2026-10-15T10:05:00.000Z",
};
const PLAN = toBatchPlan(WIRE)!;

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  unlisten.mockReset();
  handler = null;
  listenMock.mockImplementation(async (_name, cb) => {
    handler = cb as EventCallback<unknown>;
    return unlisten;
  });
});

describe("toBatchPlan", () => {
  it("accepts the wire shape and rejects every malformed field", () => {
    expect(PLAN).toEqual(WIRE);
    expect(toBatchPlan({ ...WIRE, items: [] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, items: [WIRE.items[0], WIRE.items[0]] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, items: [{ ...WIRE.items[0], lines: [] }] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, items: [{ ...WIRE.items[0], ruleId: "nope" }] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, items: [{ ...WIRE.items[0], recheck: ["nope"] }] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, items: [{ ...WIRE.items[0], previous: 3 }] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, excluded: [{ ruleId: "TL-MAC-002", error: "busy" }] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, excluded: [{ ruleId: "TL-MAC-011", error: "nope" }] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, excluded: "x" })).toBeNull();
    expect(toBatchPlan({ ...WIRE, needsPassword: "yes" })).toBeNull();
    expect(toBatchPlan({ ...WIRE, recheck: ["nope"] })).toBeNull();
    expect(toBatchPlan({ ...WIRE, expiresAt: "soon" })).toBeNull();
    expect(toBatchPlan({ ...WIRE, planId: "" })).toBeNull();
    expect(toBatchPlan(null)).toBeNull();
  });
});

describe("toBatchOutcome", () => {
  it("keeps items whose rule is in the plan and folds anything else into command_failed", () => {
    const ok = { ok: true, items: [{ ruleId: "TL-MAC-002", status: "done", error: null, step: null }], error: null };
    expect(toBatchOutcome(ok, PLAN)).toEqual(ok);
    const failed = { ok: false, items: [{ ruleId: "TL-MAC-002", status: "failed", error: "timeout", step: 0 }], error: "timeout" };
    expect(toBatchOutcome(failed, PLAN)).toEqual(failed);
    expect(toBatchOutcome({ ok: false, items: [], error: "nope" }, PLAN)).toEqual({ ok: false, items: [], error: "command_failed" });
    const bad = { ok: false, items: [], error: "command_failed" };
    expect(toBatchOutcome({ ...ok, items: [{ ruleId: "TL-MAC-011", status: "done", error: null, step: null }] }, PLAN)).toEqual(bad);
    expect(toBatchOutcome({ ...ok, items: [{ ruleId: "TL-MAC-002", status: "skipped", error: null, step: null }] }, PLAN)).toEqual(bad);
    expect(toBatchOutcome({ ...ok, items: [{ ruleId: "TL-MAC-002", status: "done", error: "nope", step: null }] }, PLAN)).toEqual(bad);
    expect(toBatchOutcome({ ...ok, items: [{ ruleId: "TL-MAC-002", status: "done", error: null, step: "1" }] }, PLAN)).toEqual(bad);
    expect(toBatchOutcome({ ok: true }, PLAN)).toEqual(bad);
    expect(toBatchOutcome("done", PLAN)).toEqual(bad);
  });
});

describe("toFixProgress item", () => {
  it("passes an integer item through and drops a malformed one", () => {
    expect(toFixProgress({ planId: "p", phase: "running", step: 1, of: 2, item: 2 })).toEqual({ planId: "p", phase: "running", step: 1, of: 2, item: 2 });
    expect(toFixProgress({ planId: "p", phase: "running", step: 1, of: 2 })).toEqual({ planId: "p", phase: "running", step: 1, of: 2 });
    expect(toFixProgress({ planId: "p", phase: "running", step: 1, of: 2, item: "2" })).toEqual({ planId: "p", phase: "running", step: 1, of: 2 });
  });
});

describe("TauriFixAdapter batch", () => {
  it("previewBatch sends the ids to fix_preview_batch and validates the answer", async () => {
    invokeMock.mockResolvedValueOnce(WIRE);
    const adapter = new TauriFixAdapter();
    expect(await adapter.previewBatch(["TL-MAC-002", "TL-MAC-003"])).toEqual(PLAN);
    expect(invokeMock).toHaveBeenCalledWith("fix_preview_batch", { rules: ["TL-MAC-002", "TL-MAC-003"] });
    invokeMock.mockResolvedValueOnce({ ...WIRE, items: [] });
    await expect(adapter.previewBatch(["TL-MAC-002"])).rejects.toBe("command_failed");
    await expect(adapter.previewBatch([])).rejects.toBe("invalid_choice");
    await expect(adapter.previewBatch(["TL-MAC-002", "TL-MAC-002"])).rejects.toBe("invalid_choice");
    await expect(adapter.previewBatch(["nope" as never])).rejects.toBe("not_in_catalog");
    await expect(adapter.previewBatch(Array.from({ length: MAX_BATCH_RULES + 1 }, (_, i) => `TL-MAC-${String(i).padStart(3, "0")}` as never))).rejects.toBe("invalid_choice");
  });

  it("applyBatch listens for fix:status with item, calls fix_apply_batch, and folds a rejection", async () => {
    const adapter = new TauriFixAdapter();
    invokeMock.mockResolvedValueOnce(WIRE);
    await adapter.previewBatch(["TL-MAC-002", "TL-MAC-003"]);
    const seen: FixProgress[] = [];
    invokeMock.mockImplementationOnce(async () => {
      handler?.({ event: "fix:status", id: 1, payload: { planId: "b1", phase: "running", step: 1, of: 2, item: 1 } });
      handler?.({ event: "fix:status", id: 2, payload: { planId: "other", phase: "running", step: 1, of: 2, item: 1 } });
      return { ok: true, items: [{ ruleId: "TL-MAC-002", status: "done", error: null, step: null }], error: null };
    });
    const outcome = await adapter.applyBatch("b1", { onProgress: (p) => seen.push(p) });
    expect(outcome).toEqual({ ok: true, items: [{ ruleId: "TL-MAC-002", status: "done", error: null, step: null }], error: null });
    expect(seen).toEqual([{ planId: "b1", phase: "running", step: 1, of: 2, item: 1 }]);
    expect(invokeMock).toHaveBeenLastCalledWith("fix_apply_batch", { plan: "b1" });
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(await adapter.applyBatch("b1")).toEqual({ ok: false, items: [], error: "plan_expired" });
    invokeMock.mockResolvedValueOnce(WIRE);
    await adapter.previewBatch(["TL-MAC-002", "TL-MAC-003"]);
    invokeMock.mockRejectedValueOnce("busy");
    expect(await adapter.applyBatch("b1")).toEqual({ ok: false, items: [], error: "busy" });
    invokeMock.mockResolvedValueOnce(WIRE);
    await adapter.previewBatch(["TL-MAC-002", "TL-MAC-003"]);
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    expect(await adapter.applyBatch("b1")).toEqual({ ok: false, items: [], error: "command_failed" });
  });

  it("applyBatch on an aborted signal returns cancelled without invoking, and an abort during the run calls fix_cancel", async () => {
    const adapter = new TauriFixAdapter();
    invokeMock.mockResolvedValueOnce(WIRE);
    await adapter.previewBatch(["TL-MAC-002", "TL-MAC-003"]);
    const aborted = new AbortController();
    aborted.abort();
    expect(await adapter.applyBatch("b1", { signal: aborted.signal })).toEqual({ ok: false, items: [], error: "cancelled" });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    invokeMock.mockImplementationOnce(async () => {
      controller.abort();
      return { ok: false, items: [], error: "cancelled" };
    });
    invokeMock.mockResolvedValueOnce(undefined);
    expect(await adapter.applyBatch("b1", { signal: controller.signal })).toEqual({ ok: false, items: [], error: "cancelled" });
    expect(invokeMock).toHaveBeenCalledWith("fix_cancel", { plan: "b1" });
  });
});
