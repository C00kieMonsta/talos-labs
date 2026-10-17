import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import type { FixOutcome, GuidedMemory } from "@talos/core";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, HARDENED } from "@talos/core";
import { fakeAdapters, fakeFixPort, fakePlan, fakeSystemState } from "../app/testing";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import { NOW, renderGuided, reportFor } from "./testing";
import type { HarnessOptions } from "./testing";
import { resetLaunchGuard } from "./timing";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetLaunchGuard();
});

const CHATGPT_RECENT: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, aiLastAvailable: { provider: "chatgpt", at: new Date().toISOString() } };
const CHAT_SETTINGS: Partial<AppSettings> = { explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" } };

async function scanToReady(hook: ReturnType<typeof renderGuided>["hook"]) {
  await act(async () => {
    await hook.result.current.scan.start();
  });
  await act(async () => {
    await hook.result.current.scan.present();
  });
}

async function renderChat(options: HarnessOptions = {}) {
  const h = renderGuided({ memory: CHATGPT_RECENT, settings: CHAT_SETTINGS, ...options });
  await scanToReady(h.hook);
  return h;
}

describe("the chat home", () => {
  it("opens when the stored availability names the chosen provider within the TTL and the switch is on", async () => {
    const h = await renderChat();
    const { phase, progress, chat } = h.hook.result.current.guided;
    expect(phase.kind).toBe("chat");
    if (phase.kind !== "chat") return;
    expect(phase.plan.steps.map((s) => s.id)).toEqual(["fix:TL-MAC-002", "show:TL-MAC-001", "show:TL-MAC-010", "permission:full_disk_access", "paywall"]);
    expect(phase.diff).toBeNull();
    expect(phase.resumed).toBe(false);
    expect(progress).toEqual({ done: 0, of: 5 });
    expect(chat.plan).toBe(phase.plan);
    expect(chat.undone().map((s) => s.id)).toEqual(phase.plan.steps.map((s) => s.id));
    expect(chat.atEnd()).toBe(false);
  });

  it("stays on the plan with the switch off, another provider, AI off, or a stored value older than the TTL", async () => {
    const cases: HarnessOptions[] = [
      { settings: { ...CHAT_SETTINGS, guided: { ...DEFAULT_SETTINGS.guided, chatHome: false } } },
      { settings: { explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude_plan" } } },
      { settings: { explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt", aiEnabled: false } } },
      { memory: { ...EMPTY_GUIDED_MEMORY, aiLastAvailable: { provider: "chatgpt", at: new Date(Date.now() - 8 * 86_400_000).toISOString() } } },
      { memory: EMPTY_GUIDED_MEMORY },
    ];
    for (const options of cases) {
      const h = await renderChat(options);
      expect(h.hook.result.current.guided.phase.kind, JSON.stringify(options)).toBe("plan");
      expect(h.hook.result.current.guided.chat.plan).toBeNull();
      cleanup();
    }
  });

  it("folds the launch diff into the chat and resumes there after a guided relaunch", async () => {
    const since = await renderChat({ loadedReport: reportFor(HARDENED) });
    const phase = since.hook.result.current.guided.phase;
    expect(phase.kind).toBe("chat");
    if (phase.kind === "chat") expect(phase.diff?.appeared.length).toBeGreaterThan(0);
    cleanup();
    const resumed = await renderChat({ resume: true, loadedReport: reportFor(HARDENED) });
    const after = resumed.hook.result.current.guided.phase;
    expect(after.kind).toBe("chat");
    if (after.kind === "chat") expect(after.resumed).toBe(true);
  });

  it("Step by step enters the walk-through at the first undone step, and Chat comes back on the same plan", async () => {
    const h = await renderChat();
    act(() => h.hook.result.current.guided.chat.stepByStep());
    const step = h.hook.result.current.guided.phase;
    expect(step.kind).toBe("step");
    if (step.kind === "step") {
      expect(step.index).toBe(0);
      expect(step.plan.steps[0]?.id).toBe("fix:TL-MAC-002");
    }
    act(() => h.hook.result.current.guided.chat.toChat());
    expect(h.hook.result.current.guided.phase.kind).toBe("chat");
  });

  it("runs a fix card through Core and settles it: the plan, the walk-through and allowed all see it done", async () => {
    const passing = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } };
    const h = await renderChat({ adapters: fakeAdapters({ systemState: fakeSystemState(DEV_MACHINE, {}, passing), fixes: fakeFixPort(fakePlan({ ruleId: "TL-MAC-002" })) }) });
    const { chat } = h.hook.result.current.guided;
    const step = chat.nextUndone();
    expect(step?.id).toBe("fix:TL-MAC-002");
    if (step === null) return;
    await act(async () => {
      chat.run(step);
    });
    expect(h.adapters.fixes.apply).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      const s = h.hook.result.current.scan.scan;
      expect(s.kind === "ready" && s.fixing?.phase).toBe("done");
    });
    let landed: ReturnType<typeof chat.settle> = null;
    act(() => {
      landed = h.hook.result.current.guided.chat.settle();
    });
    expect(landed).toMatchObject({ step: { id: "fix:TL-MAC-002" }, outcome: "fixed", state: { kind: "done" } });
    const after = h.hook.result.current.guided;
    expect(after.chat.active).toBeNull();
    expect(after.chat.fixed).toEqual(["TL-MAC-002"]);
    expect(after.chat.doneStepIds).toContain("fix:TL-MAC-002");
    expect(after.chat.undone().map((s) => s.id)).not.toContain("fix:TL-MAC-002");
    expect(after.progress.done).toBe(1);
    act(() => after.chat.stepByStep());
    const walk = h.hook.result.current.guided.phase;
    expect(walk.kind === "step" && walk.plan.steps[walk.index]?.id).toBe("show:TL-MAC-001");
    expect(walk.kind === "step" && walk.index).toBe(1);
  });
});

describe("leaving the chat", () => {
  it("AI off with a card in flight opens that step in the walk-through, working, so Core settles it there", async () => {
    const h = await renderChat({ adapters: fakeAdapters({ fixes: fakeFixPort(fakePlan({ ruleId: "TL-MAC-002" }), { apply: vi.fn(() => new Promise<FixOutcome>(() => undefined)) }) }) });
    const { chat } = h.hook.result.current.guided;
    const step = chat.nextUndone();
    if (step === null) throw new Error("no step");
    await act(async () => {
      chat.run(step);
    });
    await waitFor(() => expect(h.adapters.fixes.apply).toHaveBeenCalled());
    expect(h.hook.result.current.guided.chat.active?.id).toBe("fix:TL-MAC-002");
    act(() => h.hook.result.current.guided.chat.leaveChat());
    const phase = h.hook.result.current.guided.phase;
    expect(phase.kind).toBe("step");
    if (phase.kind !== "step") return;
    expect(phase.plan.steps[phase.index]?.id).toBe("fix:TL-MAC-002");
    expect(phase.state.kind).toBe("working");
    expect(phase.plan.steps.length).toBe(5);
  });

  it("with nothing in flight goes to the plan, or to the end when every step is settled", async () => {
    const h = await renderChat();
    act(() => h.hook.result.current.guided.chat.leaveChat());
    expect(h.hook.result.current.guided.phase.kind).toBe("plan");
    act(() => h.hook.result.current.guided.chat.toChat());
    const { chat } = h.hook.result.current.guided;
    for (const step of chat.undone()) act(() => void h.hook.result.current.guided.chat.later(step));
    expect(h.hook.result.current.guided.chat.atEnd()).toBe(true);
    act(() => h.hook.result.current.guided.chat.leaveChat());
    expect(h.hook.result.current.guided.phase.kind).toBe("end");
  });

  it("a fix landed in the walk-through is done in the chat's plan", async () => {
    const passing = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } };
    const h = await renderChat({ adapters: fakeAdapters({ systemState: fakeSystemState(DEV_MACHINE, {}, passing), fixes: fakeFixPort(fakePlan({ ruleId: "TL-MAC-002" })) }) });
    act(() => h.hook.result.current.guided.chat.stepByStep());
    await act(async () => {
      h.hook.result.current.guided.primary();
    });
    await waitFor(() => {
      const phase = h.hook.result.current.guided.phase;
      expect(phase.kind === "step" && phase.state.kind).toBe("done");
    });
    act(() => h.hook.result.current.guided.chat.toChat());
    const { chat, phase } = h.hook.result.current.guided;
    expect(phase.kind).toBe("chat");
    expect(chat.doneStepIds).toContain("fix:TL-MAC-002");
    expect(chat.nextUndone()?.id).toBe("show:TL-MAC-001");
  });

  it("later snoozes the card's rules for 7 days and asks about accepting on the third; accept clears the rule for good", async () => {
    const h = await renderChat({ memory: { ...CHATGPT_RECENT, laterCount: { "TL-MAC-001": 2 } } });
    const { chat } = h.hook.result.current.guided;
    const disk = chat.undone().find((s) => s.id === "show:TL-MAC-001");
    const firewall = chat.undone().find((s) => s.id === "fix:TL-MAC-002");
    if (disk === undefined || firewall === undefined) throw new Error("steps missing");
    let asked: readonly string[] = [];
    act(() => {
      asked = h.hook.result.current.guided.chat.later(firewall);
    });
    expect(asked).toEqual([]);
    expect(h.saved.at(-1)?.snoozed["TL-MAC-002"]).toBe(new Date(Date.parse(h.saved.at(-1)?.snoozed["TL-MAC-002"] ?? "")).toISOString());
    act(() => {
      asked = h.hook.result.current.guided.chat.later(disk);
    });
    expect(asked).toEqual(["TL-MAC-001"]);
    act(() => h.hook.result.current.guided.chat.accept(["TL-MAC-001"]));
    expect(Object.keys(h.saved.at(-1)?.accepted ?? {})).toEqual(["TL-MAC-001"]);
    expect(h.hook.result.current.guided.chat.doneStepIds).toEqual(expect.arrayContaining(["fix:TL-MAC-002", "show:TL-MAC-001"]));
    expect(h.adapters.fixes.apply).not.toHaveBeenCalled();
    void NOW;
  });
});
