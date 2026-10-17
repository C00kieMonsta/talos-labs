import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import type { BatchOutcome, FixOutcome, GuidedMemory } from "@talos/core";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, HARDENED, acceptRules, nextAction } from "@talos/core";
import { fakeAdapters, fakeBatchPlan, fakeFixPort, fakePlan, fakeSystemState } from "../app/testing";
import { DEFAULT_SETTINGS } from "../settings";
import { ACCEPT, FIX, WATCH_ON } from "./copy";
import { NOW, renderGuided } from "./testing";
import { ACCEPT_FLASH_MS, AUTO_ADVANCE_MS, AUTO_ADVANCE_REDUCED_MS, LATER_FLASH_MS, resetLaunchGuard } from "./timing";

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

  it.each([
    { watch: false, text: FIX.couldNotCheck },
    { watch: true, text: WATCH_ON.couldNotCheck },
  ])("a batch item that ran but could not be rechecked says when it will check again (watch on: $watch)", async ({ watch, text }) => {
    const ruleIds = ["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"] as const;
    const outcome: BatchOutcome = { ok: true, error: null, items: ruleIds.map((ruleId) => ({ ruleId, status: "done", error: null, step: null })) };
    const adapters = fakeAdapters({
      systemState: fakeSystemState(DEV_MACHINE, { collectSection: vi.fn(async () => { throw new Error("boom"); }) }),
      fixes: fakeFixPort(fakePlan(), {
        previewBatch: vi.fn(async () => fakeBatchPlan({ items: ruleIds.map((ruleId) => ({ ruleId: ruleId as "TL-MAC-002", lines: [{ text: "x", privilege: "admin" }], recheck: ["firewall"], previous: null })), recheck: ["firewall"] })),
        applyBatch: vi.fn(async () => outcome),
      }),
    });
    const h = renderGuided({ adapters, licensed: true, settings: { watch: { ...DEFAULT_SETTINGS.watch, enabled: watch } } });
    await toFirstStep(h);
    expect(stepId(h)).toBe("batch");
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await waitFor(() => expect(stepState(h)?.kind).toBe("done"));
    const state = stepState(h);
    expect(state?.kind === "done" && state.line).toBe("Done. 3 things fixed.");
    expect(state?.kind === "done" && state.rows.map((r) => r.text)).toEqual([text, text, text]);
  });

  it("an unlicensed partial batch reads the plain could-not-check line even with the watch switch on", async () => {
    // Unlicensed, with the firewall rules as two of the three free fixes: batch(002, 003).
    const hardenedUpdates = HARDENED.sections.updates;
    const sections = {
      ...DEV_MACHINE.sections,
      diskEncryption: HARDENED.sections.diskEncryption,
      ssh: HARDENED.sections.ssh,
      backup: HARDENED.sections.backup,
      fileSharing: HARDENED.sections.fileSharing,
      updates: hardenedUpdates.status === "ok" ? { ...hardenedUpdates, data: { ...hardenedUpdates.data, appStoreAutoUpdate: false } } : hardenedUpdates,
    };
    const state = { ...DEV_MACHINE, sections };
    const ruleIds = ["TL-MAC-002", "TL-MAC-003"] as const;
    const outcome: BatchOutcome = { ok: true, error: null, items: ruleIds.map((ruleId) => ({ ruleId, status: "done", error: null, step: null })) };
    const adapters = fakeAdapters({
      systemState: fakeSystemState(state, { collectSection: vi.fn(async () => { throw new Error("boom"); }) }),
      fixes: fakeFixPort(fakePlan(), { previewBatch: vi.fn(async () => fakeBatchPlan()), applyBatch: vi.fn(async () => outcome) }),
    });
    const h = renderGuided({ adapters, licensed: false, settings: { watch: { ...DEFAULT_SETTINGS.watch, enabled: true } } });
    await toFirstStep(h);
    expect(stepId(h)).toBe("batch");
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await waitFor(() => expect(stepState(h)?.kind).toBe("done"));
    const done = stepState(h);
    expect(done?.kind === "done" && done.rows.map((r) => r.text)).toEqual([FIX.couldNotCheck, FIX.couldNotCheck]);
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

  it("'Not now' on a paywall with a converted show step behind it still ends", async () => {
    vi.useFakeTimers();
    // Unlicensed, with the firewall rules as two of the three free fixes: batch(002, 003), permission, paywall (011 locked).
    const hardenedUpdates = HARDENED.sections.updates;
    const sections = {
      ...DEV_MACHINE.sections,
      diskEncryption: HARDENED.sections.diskEncryption,
      ssh: HARDENED.sections.ssh,
      backup: HARDENED.sections.backup,
      fileSharing: HARDENED.sections.fileSharing,
      updates: hardenedUpdates.status === "ok" ? { ...hardenedUpdates, data: { ...hardenedUpdates.data, appStoreAutoUpdate: false } } : hardenedUpdates,
    };
    const state = { ...DEV_MACHINE, sections };
    // On recheck the firewall is on but stealth mode is not: 002 passes, 003 fails and has a pane.
    const partial = { ...state, sections: { ...sections, firewall: { status: "ok" as const, data: { enabled: true, stealthMode: false, blockAllIncoming: false } } } };
    const outcome: BatchOutcome = { ok: false, error: "cancelled", items: [{ ruleId: "TL-MAC-002", status: "not_run", error: null, step: null }, { ruleId: "TL-MAC-003", status: "not_run", error: null, step: null }] };
    const adapters = fakeAdapters({
      systemState: fakeSystemState(state, {}, partial),
      fixes: fakeFixPort(fakePlan(), { previewBatch: vi.fn(async () => fakeBatchPlan()), applyBatch: vi.fn(async () => outcome) }),
    });
    const h = renderGuided({ adapters, licensed: false });
    await toFirstStep(h);
    expect(stepId(h)).toBe("batch");
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stepState(h)?.kind).toBe("done");
    const planned = h.hook.result.current.guided.phase;
    expect(planned.kind === "step" && planned.plan.steps.map((s) => s.id)).toEqual(["batch", "permission:full_disk_access", "paywall", "show:TL-MAC-003"]);
    act(() => h.hook.result.current.guided.carryOn());
    expect(stepId(h)).toBe("permission:full_disk_access");
    act(() => h.hook.result.current.guided.later());
    expect(stepId(h)).toBe("paywall");
    act(() => h.hook.result.current.guided.later());
    expect(Date.parse(h.saved[h.saved.length - 1]?.paywallSnoozedUntil ?? "") - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
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

  it("Unlock in the disclosure opens the paywall before the current step, and leaving it returns there without growing the total", async () => {
    vi.useFakeTimers();
    const h = renderGuided();
    await toFirstStep(h);
    expect(stepId(h)).toBe("fix:TL-MAC-002");
    const total = h.hook.result.current.guided.progress.of;
    const before = h.hook.result.current.guided.phase;
    const hadPaywall = before.kind === "step" && before.plan.steps.some((s) => s.kind === "paywall");
    expect(hadPaywall).toBe(true);
    act(() => h.hook.result.current.guided.goToPaywall());
    expect(stepId(h)).toBe("paywall");
    expect(h.hook.result.current.guided.progress.of).toBe(total);
    expect(h.hook.result.current.guided.progress.done).toBe(0);
    act(() => h.hook.result.current.guided.later());
    expect(stepId(h)).toBe("fix:TL-MAC-002");
    expect(Date.parse(h.saved[h.saved.length - 1]?.paywallSnoozedUntil ?? "") - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    const after = h.hook.result.current.guided.phase;
    expect(after.kind === "step" && after.plan.steps.filter((s) => s.kind === "paywall").length).toBe(1);
    // Unlock again opens the same paywall, still one in the plan; on the paywall itself the button does nothing.
    act(() => h.hook.result.current.guided.goToPaywall());
    expect(stepId(h)).toBe("paywall");
    expect(h.hook.result.current.guided.progress.of).toBe(total);
    act(() => h.hook.result.current.guided.goToPaywall());
    expect(stepId(h)).toBe("paywall");
    const again = h.hook.result.current.guided.phase;
    expect(again.kind === "step" && again.plan.steps.filter((s) => s.kind === "paywall").length).toBe(1);
  });

  it("a report rebuilt while the moved paywall is the current step keeps one paywall in place and skips nothing", async () => {
    vi.useFakeTimers();
    // The next recheck reads a hardened Mac, so the current rule passes and the plan is rebuilt around the paywall.
    const h = renderGuided({ adapters: fakeAdapters({ systemState: fakeSystemState(DEV_MACHINE, {}, HARDENED) }) });
    await toFirstStep(h);
    expect(stepId(h)).toBe("fix:TL-MAC-002");
    act(() => h.hook.result.current.guided.goToPaywall());
    expect(stepId(h)).toBe("paywall");
    const before = h.hook.result.current.guided.phase;
    const index = before.kind === "step" ? before.index : -1;
    expect(index).toBe(0);
    await act(async () => {
      await h.hook.result.current.scan.recheck(["firewall"]);
    });
    const after = h.hook.result.current.guided.phase;
    expect(after.kind).toBe("step");
    if (after.kind !== "step") return;
    expect(after.index).toBe(index);
    expect(after.plan.steps.filter((s) => s.kind === "paywall")).toHaveLength(1);
    expect(stepId(h)).toBe("paywall");
    // The steps the person had not done yet are still ahead of the paywall, none of them passed.
    expect(after.plan.steps.slice(index + 1).map((s) => s.kind)).toEqual(expect.arrayContaining(["show", "permission"]));
    expect(h.hook.result.current.guided.progress.done).toBe(0);
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

/** A memory with the given Later counts and nothing else. */
function counted(laterCount: Record<string, number>, extra: Partial<GuidedMemory> = {}): GuidedMemory {
  return { ...EMPTY_GUIDED_MEMORY, laterCount, ...extra };
}

async function flash(h: Harness, ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function lastSaved(h: Harness): GuidedMemory {
  return h.saved[h.saved.length - 1] as GuidedMemory;
}

describe("the third Later asks instead of retiring", () => {
  it("the first and second Later flash and advance as today; the third writes the snooze and the count, then asks about that rule", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ memory: counted({ "TL-MAC-002": 1 }) });
    await toFirstStep(h);
    expect(stepId(h)).toBe("fix:TL-MAC-002");
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)?.kind).toBe("later_flash");
    expect(lastSaved(h).laterCount["TL-MAC-002"]).toBe(2);
    await flash(h, LATER_FLASH_MS);
    expect(stepId(h)).toBe("show:TL-MAC-001");
    cleanup();
    const third = renderGuided({ memory: counted({ "TL-MAC-002": 2 }) });
    await toFirstStep(third);
    act(() => third.hook.result.current.guided.later());
    expect(stepState(third)).toEqual({ kind: "ask_accept", ruleIds: ["TL-MAC-002"] });
    const memory = lastSaved(third);
    expect(memory.laterCount["TL-MAC-002"]).toBe(3);
    expect(Date.parse(memory.snoozed["TL-MAC-002"] ?? "") - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(memory.accepted).toEqual({});
    // Nothing moves on its own: the question waits for an answer.
    await flash(third, ACCEPT_FLASH_MS);
    expect(stepState(third)?.kind).toBe("ask_accept");
  });

  it("the third Later on a watching show step stops the watcher before asking", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ memory: counted({ "TL-MAC-001": 2 }) });
    await toFirstStep(h);
    act(() => h.hook.result.current.guided.later());
    await flash(h, LATER_FLASH_MS);
    expect(stepId(h)).toBe("show:TL-MAC-001");
    act(() => h.hook.result.current.guided.primary());
    expect(stepState(h)?.kind).toBe("watching");
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)).toEqual({ kind: "ask_accept", ruleIds: ["TL-MAC-001"] });
    const scan = h.hook.result.current.scan.scan;
    expect(scan.kind === "ready" && scan.watching).toBeNull();
  });

  it("No, keep asking writes the count back to 0 and advances with the snooze in place and no flash", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ memory: counted({ "TL-MAC-002": 2 }) });
    await toFirstStep(h);
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)?.kind).toBe("ask_accept");
    const snoozed = lastSaved(h).snoozed["TL-MAC-002"];
    act(() => h.hook.result.current.guided.keepAsking());
    expect(stepId(h)).toBe("show:TL-MAC-001");
    expect(stepState(h)?.kind).toBe("idle");
    const memory = lastSaved(h);
    expect(memory.laterCount["TL-MAC-002"]).toBe(0);
    expect(memory.snoozed["TL-MAC-002"]).toBe(snoozed);
    expect(memory.accepted).toEqual({});
  });

  it("Leave it alone writes accepted at now, removes the rule's snooze, count and waiting, flashes for 1400 ms and advances", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ memory: counted({ "TL-MAC-002": 2 }, { waiting: { "TL-MAC-002": "2026-10-17T00:00:00.000Z" } }) });
    await toFirstStep(h);
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)?.kind).toBe("ask_accept");
    act(() => h.hook.result.current.guided.accept());
    expect(stepState(h)).toEqual({ kind: "later_flash", text: ACCEPT.flash });
    const memory = lastSaved(h);
    expect(Math.abs(Date.parse(memory.accepted["TL-MAC-002"] ?? "") - Date.now())).toBeLessThan(1000);
    expect(memory.snoozed["TL-MAC-002"]).toBeUndefined();
    expect(memory.laterCount["TL-MAC-002"]).toBeUndefined();
    expect(memory.waiting["TL-MAC-002"]).toBeUndefined();
    await flash(h, ACCEPT_FLASH_MS - 1);
    expect(stepState(h)?.kind).toBe("later_flash");
    await flash(h, 1);
    expect(stepId(h)).toBe("show:TL-MAC-001");
    // No fix ran on the way.
    expect(h.adapters.fixes.preview).not.toHaveBeenCalled();
    expect(h.adapters.fixes.apply).not.toHaveBeenCalled();
  });

  it("on a licensed batch the third Later asks only about the rules at the count; the rest keep their fresh snooze", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ licensed: true, memory: counted({ "TL-MAC-002": 2, "TL-MAC-003": 0, "TL-MAC-011": 0 }) });
    await toFirstStep(h);
    expect(stepId(h)).toBe("batch");
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)).toEqual({ kind: "ask_accept", ruleIds: ["TL-MAC-002"] });
    const asked = lastSaved(h);
    for (const id of ["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"]) expect(asked.snoozed[id]).toBeTruthy();
    expect(asked.laterCount).toMatchObject({ "TL-MAC-002": 3, "TL-MAC-003": 1, "TL-MAC-011": 1 });
    act(() => h.hook.result.current.guided.accept());
    expect(stepState(h)).toEqual({ kind: "later_flash", text: ACCEPT.flash });
    const memory = lastSaved(h);
    expect(Object.keys(memory.accepted)).toEqual(["TL-MAC-002"]);
    expect(memory.snoozed["TL-MAC-002"]).toBeUndefined();
    expect(memory.snoozed["TL-MAC-003"]).toBe(asked.snoozed["TL-MAC-003"]);
    expect(memory.snoozed["TL-MAC-011"]).toBe(asked.snoozed["TL-MAC-011"]);
    expect(h.adapters.fixes.previewBatch).not.toHaveBeenCalled();
  });

  it("asks with the plural strings when two rules of a batch are at the count", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ licensed: true, memory: counted({ "TL-MAC-002": 2, "TL-MAC-003": 2 }) });
    await toFirstStep(h);
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)).toEqual({ kind: "ask_accept", ruleIds: ["TL-MAC-002", "TL-MAC-003"] });
    act(() => h.hook.result.current.guided.accept());
    expect(stepState(h)).toEqual({ kind: "later_flash", text: ACCEPT.flashMany });
    expect(Object.keys(lastSaved(h).accepted).sort()).toEqual(["TL-MAC-002", "TL-MAC-003"]);
  });

  it("a memory with a count of 3 from before is a step again and asks on its next Later, at 4", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ memory: counted({ "TL-MAC-010": 3 }) });
    await toFirstStep(h);
    const { phase } = h.hook.result.current.guided;
    expect(phase.kind === "step" && phase.plan.steps.map((s) => s.id)).toContain("show:TL-MAC-010");
    for (let i = 0; i < 2; i += 1) {
      act(() => h.hook.result.current.guided.later());
      await flash(h, LATER_FLASH_MS);
    }
    expect(stepId(h)).toBe("show:TL-MAC-010");
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)).toEqual({ kind: "ask_accept", ruleIds: ["TL-MAC-010"] });
    expect(lastSaved(h).laterCount["TL-MAC-010"]).toBe(4);
  });

  it("finalPlan lists a rule accepted this run under plan.accepted, out of later, and it is never the next card", async () => {
    vi.useFakeTimers();
    const h = renderGuided({ memory: counted({ "TL-MAC-001": 2 }) });
    await toFirstStep(h);
    act(() => h.hook.result.current.guided.later());
    await flash(h, LATER_FLASH_MS);
    expect(stepId(h)).toBe("show:TL-MAC-001");
    act(() => h.hook.result.current.guided.later());
    act(() => h.hook.result.current.guided.accept());
    await flash(h, ACCEPT_FLASH_MS);
    act(() => h.hook.result.current.guided.later());
    await flash(h, LATER_FLASH_MS);
    act(() => h.hook.result.current.guided.later());
    act(() => h.hook.result.current.guided.later());
    const end = h.hook.result.current.guided.phase;
    expect(end.kind).toBe("end");
    if (end.kind !== "end") return;
    expect(end.plan.accepted).toEqual(["TL-MAC-001"]);
    expect(end.plan.later).toEqual(["TL-MAC-002", "TL-MAC-010"]);
    const scan = h.hook.result.current.scan.scan;
    const next = scan.kind === "ready" ? nextAction(end.plan, scan.report) : null;
    // 001 carries the most points and would be the card today; accepted, it never is.
    expect(next).not.toBeNull();
    expect(next?.ruleId).not.toBe("TL-MAC-001");
  });

  it("a converted show step that is then accepted is gone from the extras, the lists and the next card, and a rebuild does not bring it back", async () => {
    const adapters = fakeAdapters({ fixes: fakeFixPort(fakePlan({ ruleId: "TL-MAC-002" }), { apply: vi.fn(async (): Promise<FixOutcome> => ({ ok: false, error: "command_failed", step: 1 })) }) });
    const h = renderGuided({ adapters, memory: counted({ "TL-MAC-002": 2 }) });
    await toFirstStep(h);
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await waitFor(() => expect(stepState(h)).toMatchObject({ kind: "failed", error: "command_failed" }));
    act(() => h.hook.result.current.guided.primary());
    expect(stepId(h)).toBe("show:TL-MAC-002");
    act(() => h.hook.result.current.guided.later());
    expect(stepState(h)).toEqual({ kind: "ask_accept", ruleIds: ["TL-MAC-002"] });
    // The fix port's promises have settled; the flashes from here run on fake timers.
    vi.useFakeTimers();
    act(() => h.hook.result.current.guided.accept());
    await flash(h, ACCEPT_FLASH_MS);
    expect(stepId(h)).toBe("show:TL-MAC-001");
    // A rebuild from the same report: the converted step is not proposed again ahead of the person.
    await act(async () => {
      await h.hook.result.current.scan.recheck(["firewall"]);
    });
    const phase = h.hook.result.current.guided.phase;
    expect(phase.kind).toBe("step");
    if (phase.kind !== "step") return;
    expect(phase.plan.steps.slice(phase.index).map((s) => s.id)).not.toContain("show:TL-MAC-002");
    expect(phase.plan.steps.slice(phase.index).map((s) => s.id)).not.toContain("fix:TL-MAC-002");
    expect(phase.plan.accepted).toEqual(["TL-MAC-002"]);
    expect(phase.plan.leftAlone).not.toContain("TL-MAC-002");
    act(() => h.hook.result.current.guided.later());
    await flash(h, LATER_FLASH_MS);
    act(() => h.hook.result.current.guided.later());
    await flash(h, LATER_FLASH_MS);
    act(() => h.hook.result.current.guided.later());
    act(() => h.hook.result.current.guided.later());
    const end = h.hook.result.current.guided.phase;
    expect(end.kind).toBe("end");
    if (end.kind !== "end") return;
    expect(end.plan.leftAlone).not.toContain("TL-MAC-002");
    expect(end.plan.later).not.toContain("TL-MAC-002");
    const scan = h.hook.result.current.scan.scan;
    expect(scan.kind === "ready" && nextAction(end.plan, scan.report)?.ruleId).not.toBe("TL-MAC-002");
  });

  it("a rule left alone after a batch and a converted one, both accepted on Details, leave plan.leftAlone and the steps ahead", async () => {
    // Every item runs but nothing changes on recheck: 002 and 003 become show steps (extras), 011 has no pane and is left alone.
    const ruleIds = ["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"] as const;
    const outcome: BatchOutcome = { ok: true, error: null, items: ruleIds.map((ruleId) => ({ ruleId, status: "done", error: null, step: null })) };
    const adapters = fakeAdapters({ fixes: fakeFixPort(fakePlan(), { previewBatch: vi.fn(async () => fakeBatchPlan({ items: ruleIds.map((ruleId) => ({ ruleId: ruleId as "TL-MAC-002", lines: [{ text: "x", privilege: "admin" }], recheck: ["firewall"], previous: null })), recheck: ["firewall"] })), applyBatch: vi.fn(async () => outcome) }) });
    const h = renderGuided({ adapters, licensed: true });
    await toFirstStep(h);
    expect(stepId(h)).toBe("batch");
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await waitFor(() => expect(stepState(h)?.kind).toBe("done"));
    act(() => h.hook.result.current.guided.carryOn());
    const before = h.hook.result.current.guided.phase;
    expect(before.kind).toBe("step");
    if (before.kind !== "step") return;
    const index = before.index;
    expect(before.plan.steps.map((s) => s.id)).toEqual(expect.arrayContaining(["show:TL-MAC-002", "show:TL-MAC-003"]));
    // Accepted from the Finding detail: the outside memory is adopted and the plan rebuilt in place.
    h.control.memory = acceptRules(h.control.memory, ["TL-MAC-003", "TL-MAC-011"], NOW);
    h.hook.rerender();
    const phase = h.hook.result.current.guided.phase;
    expect(phase.kind).toBe("step");
    if (phase.kind !== "step") return;
    expect(phase.index).toBe(index);
    expect(phase.plan.steps.slice(index).map((s) => s.id)).toContain("show:TL-MAC-002");
    expect(phase.plan.steps.slice(index).map((s) => s.id)).not.toContain("show:TL-MAC-003");
    expect(phase.plan.leftAlone).not.toContain("TL-MAC-011");
    expect(phase.plan.leftAlone).not.toContain("TL-MAC-003");
    expect(phase.plan.accepted).toEqual(["TL-MAC-003", "TL-MAC-011"]);
    const scan = h.hook.result.current.scan.scan;
    const next = scan.kind === "ready" ? nextAction(phase.plan, scan.report) : null;
    expect(["TL-MAC-003", "TL-MAC-011"]).not.toContain(next?.ruleId);
  });

  it("an accept through deps.memory while on that rule's step removes the step and holds the index", async () => {
    vi.useFakeTimers();
    const h = renderGuided();
    await toFirstStep(h);
    expect(stepId(h)).toBe("fix:TL-MAC-002");
    h.control.memory = acceptRules(h.control.memory, ["TL-MAC-002"], NOW);
    h.hook.rerender();
    const phase = h.hook.result.current.guided.phase;
    expect(phase.kind).toBe("step");
    if (phase.kind !== "step") return;
    expect(phase.index).toBe(0);
    expect(stepId(h)).toBe("show:TL-MAC-001");
    expect(phase.plan.steps.map((s) => s.id)).not.toContain("fix:TL-MAC-002");
    expect(phase.plan.accepted).toEqual(["TL-MAC-002"]);
    expect(h.saved).toHaveLength(0);
  });

  it("an outside write that only changes aiAskedAt does not rebuild: the phase object is held", async () => {
    vi.useFakeTimers();
    const h = renderGuided();
    await toFirstStep(h);
    const before = h.hook.result.current.guided.phase;
    h.control.memory = { ...h.control.memory, aiAskedAt: NOW };
    h.hook.rerender();
    expect(h.hook.result.current.guided.phase).toBe(before);
    // A reset that clears a non-empty map does rebuild: the rule comes back as a step.
    h.control.memory = acceptRules(h.control.memory, ["TL-MAC-002"], NOW);
    h.hook.rerender();
    expect(stepId(h)).toBe("show:TL-MAC-001");
    h.control.memory = EMPTY_GUIDED_MEMORY;
    h.hook.rerender();
    const after = h.hook.result.current.guided.phase;
    expect(after.kind === "step" && after.plan.steps.map((s) => s.id)).toContain("fix:TL-MAC-002");
    expect(after.kind === "step" && after.plan.accepted).toEqual([]);
    // The person keeps their place: the rule lands before the current step, as any rebuild does.
    expect(stepId(h)).toBe("show:TL-MAC-001");
  });

  it("landing clears an acceptance whose check now passes and keeps 010 and 027 through theirs", async () => {
    const state = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall, updates: HARDENED.sections.updates, backup: HARDENED.sections.backup } };
    const memory: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, accepted: { "TL-MAC-002": NOW, "TL-MAC-010": NOW, "TL-MAC-027": NOW, "TL-MAC-001": NOW } };
    const h = renderGuided({ adapters: fakeAdapters({ systemState: fakeSystemState(state) }), memory });
    await act(async () => {
      await h.hook.result.current.scan.start();
    });
    await act(async () => {
      await h.hook.result.current.scan.present();
    });
    const saved = lastSaved(h);
    expect(Object.keys(saved.accepted).sort()).toEqual(["TL-MAC-001", "TL-MAC-010", "TL-MAC-027"]);
    const { phase } = h.hook.result.current.guided;
    expect(phase.kind === "plan" && phase.plan.accepted).toEqual(["TL-MAC-001"]);
  });
});
