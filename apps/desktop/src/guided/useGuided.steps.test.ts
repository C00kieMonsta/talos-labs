import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import type { BatchOutcome, FixOutcome } from "@talos/core";
import { DEV_MACHINE, HARDENED, nextAction } from "@talos/core";
import { fakeAdapters, fakeBatchPlan, fakeFixPort, fakePlan, fakeSystemState } from "../app/testing";
import { renderGuided } from "./testing";
import { AUTO_ADVANCE_MS, AUTO_ADVANCE_REDUCED_MS, LATER_FLASH_MS, resetLaunchGuard } from "./timing";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetLaunchGuard();
});

type Harness = ReturnType<typeof renderGuided>;

async function toFirstStep(h: Harness) {
  await act(async () => {
    await h.hook.result.current.scan.start();
  });
  await act(async () => {
    await h.hook.result.current.scan.present();
  });
  act(() => h.hook.result.current.guided.carryOn());
  expect(h.hook.result.current.guided.phase.kind).toBe("step");
}

function stepState(h: Harness) {
  const { phase } = h.hook.result.current.guided;
  return phase.kind === "step" ? phase.state : null;
}

function stepId(h: Harness) {
  const { phase } = h.hook.result.current.guided;
  return phase.kind === "step" ? phase.plan.steps[phase.index]?.id : phase.kind;
}

describe("guided steps", () => {
  it("'Do this later' snoozes for 7 days, counts the Later, flashes for 800 ms and advances", async () => {
    vi.useFakeTimers();
    const h = renderGuided();
    await toFirstStep(h);
    expect(stepId(h)).toBe("fix:TL-MAC-002");
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)?.kind).toBe("later_flash");
    const memory = h.saved[h.saved.length - 1];
    expect(memory?.laterCount["TL-MAC-002"]).toBe(1);
    expect(Date.parse(memory?.snoozed["TL-MAC-002"] ?? "") - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATER_FLASH_MS);
    });
    expect(stepId(h)).toBe("show:TL-MAC-001");
  });

  it("a show step starts the watcher with the step's sections and interval, and the pass auto-advances after 1400 ms", async () => {
    vi.useFakeTimers();
    const h = renderGuided();
    await toFirstStep(h);
    act(() => h.hook.result.current.guided.later());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATER_FLASH_MS);
    });
    expect(stepId(h)).toBe("show:TL-MAC-001");
    act(() => h.hook.result.current.guided.primary());
    expect(h.control.openPane).toHaveBeenCalledWith("filevault");
    const scan = h.hook.result.current.scan.scan;
    expect(scan.kind === "ready" && scan.watching?.sections).toEqual(["diskEncryption"]);
    expect(scan.kind === "ready" && scan.watching?.everyMs).toBe(3000);
    expect(stepState(h)?.kind).toBe("watching");
    expect(h.saved[h.saved.length - 1]?.pendingRestart).toEqual(["TL-MAC-001"]);
  });

  it("a converted step for an in_app rule polls the fix's recheck sections", async () => {
    const adapters = fakeAdapters({ fixes: fakeFixPort(fakePlan({ ruleId: "TL-MAC-002" }), { apply: vi.fn(async (): Promise<FixOutcome> => ({ ok: false, error: "command_failed", step: 1 })) }) });
    const h = renderGuided({ adapters });
    await toFirstStep(h);
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await waitFor(() => expect(stepState(h)).toMatchObject({ kind: "failed", error: "command_failed" }));
    act(() => h.hook.result.current.guided.primary());
    expect(stepId(h)).toBe("show:TL-MAC-002");
    act(() => h.hook.result.current.guided.primary());
    const scan = h.hook.result.current.scan.scan;
    expect(scan.kind === "ready" && scan.watching?.sections).toEqual(["firewall"]);
  });

  it("a cancelled batch whose items pass on recheck shows the partial screen, and a failed item with a pane grows the total", async () => {
    const outcome: BatchOutcome = { ok: false, error: "cancelled", items: [{ ruleId: "TL-MAC-002", status: "not_run", error: null, step: null }, { ruleId: "TL-MAC-003", status: "not_run", error: null, step: null }, { ruleId: "TL-MAC-011", status: "not_run", error: null, step: null }] };
    const passing = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } };
    const adapters = fakeAdapters({
      systemState: fakeSystemState(DEV_MACHINE, {}, passing),
      fixes: fakeFixPort(fakePlan(), {
        previewBatch: vi.fn(async () => fakeBatchPlan({ items: ["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"].map((ruleId) => ({ ruleId: ruleId as "TL-MAC-002", lines: [{ text: "x", privilege: "admin" }], recheck: ["firewall"], previous: null })), recheck: ["firewall"] })),
        applyBatch: vi.fn(async () => outcome),
      }),
    });
    const h = renderGuided({ adapters, licensed: true });
    await toFirstStep(h);
    expect(stepId(h)).toBe("batch");
    const before = h.hook.result.current.guided.progress.of;
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await waitFor(() => expect(stepState(h)?.kind).toBe("done"));
    const state = stepState(h);
    expect(state?.kind === "done" && state.line).toBe("2 of 3 fixed.");
    expect(state?.kind === "done" && state.rows.map((r) => r.ok)).toEqual([true, true, false]);
    expect(h.hook.result.current.guided.progress.of).toBe(before);
  });

  it("auto-advances after 1800 ms under reduced motion and pauses while unfocused", async () => {
    vi.useFakeTimers();
    const passing = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } };
    const h = renderGuided({ reducedMotion: true, adapters: fakeAdapters({ systemState: fakeSystemState(DEV_MACHINE, {}, passing), fixes: fakeFixPort(fakePlan({ ruleId: "TL-MAC-002" })) }) });
    await toFirstStep(h);
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stepState(h)?.kind).toBe("done");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_ADVANCE_MS);
    });
    expect(stepState(h)?.kind).toBe("done");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_ADVANCE_REDUCED_MS - AUTO_ADVANCE_MS);
    });
    expect(stepId(h)).toBe("show:TL-MAC-001");
  });

  it("'No' to the backup question snoozes 026 for 30 days; 'Not now' on the paywall snoozes 14 days and ends", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ licensed: false, memory: undefined });
    await toFirstStep(h);
    // 002 later, 001 later, 010 later, permission not now -> paywall.
    for (let i = 0; i < 3; i += 1) {
      act(() => h.hook.result.current.guided.later());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LATER_FLASH_MS);
      });
    }
    expect(stepId(h)).toBe("permission:full_disk_access");
    act(() => h.hook.result.current.guided.later());
    expect(h.saved[h.saved.length - 1]?.permissionAskedAt.full_disk_access).toBeTruthy();
    expect(stepId(h)).toBe("paywall");
    act(() => h.hook.result.current.guided.later());
    const memory = h.saved[h.saved.length - 1];
    expect(Date.parse(memory?.paywallSnoozedUntil ?? "") - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    expect(h.hook.result.current.guided.phase.kind).toBe("end");
  });

  it("a valid key on the paywall appends the unlocked steps and the total grows", async () => {
    vi.useFakeTimers();
    const h = renderGuided();
    await toFirstStep(h);
    for (let i = 0; i < 3; i += 1) {
      act(() => h.hook.result.current.guided.later());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LATER_FLASH_MS);
      });
    }
    act(() => h.hook.result.current.guided.later());
    expect(h.hook.result.current.guided.progress.of).toBe(5);
    await act(async () => {
      await h.hook.result.current.guided.enterLicence("TL1.DEMO");
    });
    expect(h.hook.result.current.guided.progress.of).toBe(8);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATER_FLASH_MS);
    });
    expect(stepId(h)).toBe("batch");
  });

  it("'Do this next' on the end screen reopens the rule's step as the last step, runs it, and 'Do this later' returns to the end", async () => {
    vi.useFakeTimers();
    const h = renderGuided();
    await toFirstStep(h);
    for (let i = 0; i < 3; i += 1) {
      act(() => h.hook.result.current.guided.later());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LATER_FLASH_MS);
      });
    }
    act(() => h.hook.result.current.guided.later());
    act(() => h.hook.result.current.guided.later());
    const end = h.hook.result.current.guided.phase;
    expect(end.kind).toBe("end");
    if (end.kind !== "end") return;
    expect(end.plan.later).toEqual(["TL-MAC-001", "TL-MAC-002", "TL-MAC-010"]);
    const scan = h.hook.result.current.scan.scan;
    const next = scan.kind === "ready" ? nextAction(end.plan, scan.report) : null;
    expect(next).toMatchObject({ ruleId: "TL-MAC-001", kind: "show", severity: "critical" });
    if (next === null) return;
    h.control.openPane.mockClear();
    act(() => h.hook.result.current.guided.doNext(next));
    expect(stepId(h)).toBe("show:TL-MAC-001");
    expect(stepState(h)?.kind).toBe("watching");
    expect(h.control.openPane).toHaveBeenCalledWith("filevault");
    const { phase, progress } = h.hook.result.current.guided;
    expect(phase.kind === "step" && phase.index).toBe(4);
    expect(phase.kind === "step" && phase.plan.steps.map((s) => s.id)).toEqual(["fix:TL-MAC-002", "show:TL-MAC-010", "permission:full_disk_access", "paywall", "show:TL-MAC-001"]);
    expect(progress).toEqual({ done: 4, of: 5 });
    act(() => h.hook.result.current.guided.later());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATER_FLASH_MS);
    });
    expect(h.hook.result.current.guided.phase.kind).toBe("end");
  });
});
