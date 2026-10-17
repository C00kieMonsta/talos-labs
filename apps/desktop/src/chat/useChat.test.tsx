// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AiAvailability, GuidedMemory, WatchState } from "@talos/core";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, REMINDER_HOUR, WATCH_AGENT_PORTS_READY, askWhyQuestion, reminderDate, validateChat } from "@talos/core";
import { AppContext } from "../app/context";
import type { AppContextValue } from "../app/context";
import { fakeAdapters, fakeContextValue, fakeWatchController, fakeWatchState } from "../app/testing";
import type { GuidedPlan } from "@talos/core";
import { ACTIVITY, CHAT, END, EXPLAIN, FISHY, LATER_FLASH, WATCH } from "../guided/copy";
import { guidedFor } from "../guided/plan";
import { CHAT_REDUCED_PARTIAL_MS } from "./useChat";
import { autoAdvanceMs } from "../guided/timing";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import type { ScanState } from "../scan/machine";
import { WatchControllerContext } from "../watch/watch-controller";
import { ChatDraftContext } from "./draft";
import type { ChatDraft } from "./draft";
import type { ChatMessage } from "./state";
import { ACT_ITEM, REPORT, allowedFor, fakeBridge, planFor, scriptedExplainer } from "./testing";
import { visibleWalkRows } from "./walk";
import type { ScriptedChat } from "./testing";
import { CHAT_STILL_WAITING_MS, CHAT_WATCH_CHECK_MS, useChat } from "./useChat";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.__talosDemoPace;
});

interface Holder {
  scan: ScanState;
  availability: AiAvailability | null;
  watch: WatchState | null;
  draft: ChatDraft | null;
  consume: (seq: number) => void;
  licensed: boolean;
}

/** `memory` is what the allow-lists read; `planMemory` is what the plan was built from, so a step can outlive an accept. */
function harness(script: ScriptedChat = {}, licensed = true, memory: GuidedMemory = EMPTY_GUIDED_MEMORY, planMemory: GuidedMemory = memory) {
  const plan = planFor(licensed, planMemory);
  const { bridge, control } = fakeBridge(plan);
  const explainer = scriptedExplainer(script);
  const holder: Holder = { scan: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null }, availability: "available", watch: fakeWatchState(), draft: null, consume: vi.fn(), licensed };
  const adapters = fakeAdapters({ createExplainer: vi.fn(async () => explainer.port) });
  const watch = fakeWatchController();
  const wrapper = ({ children }: { children: ReactNode }) => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" }, watch: { ...DEFAULT_SETTINGS.watch, enabled: true } };
    const base = fakeContextValue({ adapters, license: { status: "none" }, gate: { licensed: holder.licensed, freeFixes: plan.freeFixes, has: () => holder.licensed, fixLocked: () => !holder.licensed, explainLocked: () => false, watchLocked: !holder.licensed }, scanState: holder.scan, settings, guidedMemory: memory });
    const value: AppContextValue = { ...base, ai: { ...base.ai, availability: holder.availability } };
    return createElement(AppContext.Provider, { value }, createElement(WatchControllerContext.Provider, { value: { ...watch, state: holder.watch } }, createElement(ChatDraftContext.Provider, { value: { draft: holder.draft, consume: holder.consume } }, children)));
  };
  const hook = renderHook(() => useChat(bridge), { wrapper });
  return { hook, bridge, control, explainer, holder, plan, adapters, watch };
}

const kinds = (messages: readonly ChatMessage[]) => messages.map((m) => m.kind);
const cards = (messages: readonly ChatMessage[]) => messages.filter((m): m is Extract<ChatMessage, { kind: "card" }> => m.kind === "card");

describe("useChat", () => {
  it("opens with the plan sentence, the urgent card live, no call, and chips for the opening", () => {
    const h = harness();
    const { state, chips } = h.hook.result.current;
    expect(kinds(state.messages)).toEqual(["app", "card"]);
    expect(cards(state.messages)[0]?.card.ruleId).toBe("TL-MAC-001");
    expect(h.explainer.calls).toHaveLength(0);
    expect(chips.map((c) => c.label)).toEqual([CHAT.chips.doThemAll, CHAT.chips.fixWhatYouCan, CHAT.chips.showList, ACTIVITY.chips.writeUp]);
    expect(h.hook.result.current.busy).toBe(false);
  });

  it("a typed turn streams into the block, lands the validated cards and records one call with the person's words only", async () => {
    const h = harness({ partials: ["The disk", "The disk matters."], result: { ok: true, value: { reply: "The disk matters.", relatedRuleIds: ["TL-MAC-026"], outsideScope: false, intents: [{ kind: "show_where", ruleId: "TL-MAC-001" }], locked: [] } } });
    act(() => h.hook.result.current.controller.send("Why does the disk matter?"));
    expect(kinds(h.hook.result.current.state.messages).slice(-2)).toEqual(["person", "model"]);
    expect(h.hook.result.current.busy).toBe(true);
    await waitFor(() => expect(h.hook.result.current.state.stream.kind).toBe("idle"));
    const { state } = h.hook.result.current;
    const model = state.messages.find((m) => m.kind === "model");
    expect(model?.kind === "model" && model.text).toBe("The disk matters.");
    expect(kinds(state.messages).slice(-3)).toEqual(["model", "card", "row"]);
    expect(cards(state.messages).find((c) => c.live)?.card.ruleId).toBe("TL-MAC-001");
    expect(state.calls).toBe(1);
    expect(h.explainer.calls).toHaveLength(1);
    const input = h.explainer.calls[0]!.input;
    expect(input.question).toBe("Why does the disk matter?");
    expect(input.history).toEqual([]);
    expect(input.plan.stepRuleIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(input)).not.toContain("/Users");
  });

  it("the still-waiting line fires after eight seconds with no partial and Stop keeps the turn with Send again", async () => {
    vi.useFakeTimers();
    const h = harness({ hold: true });
    act(() => h.hook.result.current.controller.send("Why?"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_STILL_WAITING_MS + 1);
    });
    const model = h.hook.result.current.state.messages.find((m) => m.kind === "model");
    expect(model?.kind === "model" && model.stillWaiting).toBe(true);
    expect(h.hook.result.current.state.announce.text).toBe(CHAT.stillWaiting.chatgpt);
    act(() => h.hook.result.current.controller.stop());
    const { state } = h.hook.result.current;
    expect(state.messages.some((m) => m.kind === "model")).toBe(false);
    const person = state.messages.find((m) => m.kind === "person");
    expect(person?.kind === "person" && person.stopped && person.resend).toBe(true);
    expect(state.composer.kind).toBe("ready");
    h.explainer.settle();
  });

  it("limit_reached mid-stream removes the partial, appends the notice and disables the field; available re-enables it", async () => {
    const h = harness({ partials: ["The disk"], fail: "limit_reached", failAfter: 1 });
    act(() => h.hook.result.current.controller.send("Why?"));
    await waitFor(() => expect(h.hook.result.current.state.composer.kind).toBe("limit"));
    const { state } = h.hook.result.current;
    expect(state.messages.some((m) => m.kind === "model")).toBe(false);
    const notice = state.messages.at(-1);
    expect(notice?.kind === "notice" && notice.text).toBe(`${EXPLAIN.limit.chatgpt} ${EXPLAIN.limitBack}`);
    expect(state.messages.find((m) => m.kind === "person")?.kind === "person" && (state.messages.find((m) => m.kind === "person") as Extract<ChatMessage, { kind: "person" }>).stopped).toBe(false);
    h.holder.availability = "limit_reached";
    h.hook.rerender();
    h.holder.availability = "available";
    h.hook.rerender();
    expect(h.hook.result.current.state.composer.kind).toBe("ready");
  });

  it("the guard, a typed chip and the accept grammar all answer without a call", () => {
    const h = harness();
    const { controller } = h.hook.result.current;
    act(() => controller.send("leave /Users/alice alone"));
    expect(h.hook.result.current.state.messages.at(-1)).toMatchObject({ kind: "notice", text: CHAT.guard });
    act(() => controller.send("show me the list"));
    expect(h.hook.result.current.state.messages.at(-1)?.kind).toBe("row");
    act(() => controller.send("I know about the disk"));
    const accept = cards(h.hook.result.current.state.messages).find((c) => c.card.kind === "accept");
    expect(accept?.card.ruleId).toBe("TL-MAC-001");
    expect(h.explainer.calls).toHaveLength(0);
  });

  it("Fix what you can lands the batch card; its primary starts the step through the bridge and the settled outcome lands as the result line", async () => {
    const h = harness();
    act(() => h.hook.result.current.controller.chip("fix_what_you_can"));
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live);
    expect(live?.card.kind).toBe("batch");
    act(() => h.hook.result.current.controller.primary(live!.id));
    expect(h.bridge.run).toHaveBeenCalledWith(h.plan.steps[0], undefined);
    expect(h.hook.result.current.state.working).toBe(live!.id);
    expect(h.hook.result.current.chips).toEqual([]);
    h.control.settled = { step: h.plan.steps[0]!, outcome: "fixed", state: { kind: "done", line: "Done. 3 things fixed.", rows: [] } };
    h.holder.scan = { ...h.holder.scan };
    h.hook.rerender();
    await waitFor(() => expect(h.hook.result.current.state.working).toBeNull());
    const done = cards(h.hook.result.current.state.messages).find((c) => c.id === live!.id);
    expect(done?.state).toBe("resolved");
    expect(done?.result).toBe("Done. 3 things fixed.");
    expect(h.hook.result.current.chips.map((c) => c.label)).toContain(CHAT.chips.whatsNext);
    expect(h.explainer.calls).toHaveLength(0);
  });

  it("Do this later snoozes through the bridge and the end message follows the last step", () => {
    const h = harness();
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    h.control.done = h.plan.steps.map((s) => s.id);
    act(() => h.hook.result.current.controller.link(live.id));
    expect(h.bridge.later).toHaveBeenCalledWith(live.step);
    const { messages } = h.hook.result.current.state;
    expect(cards(messages).find((c) => c.id === live.id)?.result).toBe(LATER_FLASH);
    expect(messages.at(-1)).toMatchObject({ kind: "app", label: "end" });
  });

  it("the watch's act-now while the chat is open appends the exchange, demotes the idle card and keeps the draft", () => {
    const h = harness();
    h.holder.draft = { text: "keep", seq: 1 };
    h.hook.rerender();
    h.holder.watch = fakeWatchState({ rating: "act_now", items: [ACT_ITEM] });
    h.hook.rerender();
    const { state, forced } = h.hook.result.current;
    expect(kinds(state.messages)).toEqual(["app", "row", "card"]);
    expect(cards(state.messages)[0]?.card.kind).toBe("watch");
    expect(forced).toBe(1);
    expect(state.draft).toBe("keep");
    h.hook.rerender();
    expect(kinds(h.hook.result.current.state.messages)).toHaveLength(3);
  });

  it("a draft equal to the top item's 'Why does ... matter?' sends once; one character off stays a draft with no call", async () => {
    const h = harness();
    h.holder.watch = fakeWatchState({ rating: "act_now", items: [ACT_ITEM] });
    h.hook.rerender();
    const exact = askWhyQuestion(FISHY.noticed.headline.persistence);
    h.holder.draft = { text: `${exact}?`, seq: 1 };
    h.hook.rerender();
    expect(h.hook.result.current.state.draft).toBe(`${exact}?`);
    expect(h.explainer.calls).toHaveLength(0);
    h.holder.draft = { text: exact, seq: 2 };
    h.hook.rerender();
    await waitFor(() => expect(h.explainer.calls).toHaveLength(1));
    expect(h.explainer.calls[0]?.input.question).toBe(exact);
  });

  it("Check now on the watch card draws the row, which the next watch:state resolves, or the 20 s fallback marks couldn't check", async () => {
    vi.useFakeTimers();
    const h = harness({ result: { ok: true, value: { reply: "The watch is on.", relatedRuleIds: [], outsideScope: false, intents: [{ kind: "open_watch", ruleId: null }], locked: [] } } });
    act(() => h.hook.result.current.controller.send("Is the watch on?"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const watchCard = cards(h.hook.result.current.state.messages).find((c) => c.card.kind === "watch");
    expect(watchCard?.item).toBeNull();
    act(() => h.hook.result.current.controller.primary(watchCard!.id));
    expect(h.watch.checkNow).toHaveBeenCalledTimes(1);
    const row = () => h.hook.result.current.extras[watchCard!.id]?.[0];
    expect(row()?.kind).toBe("watch_check");
    expect(row()?.status).toBe("running");
    expect(h.hook.result.current.state.working).toBe(watchCard!.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_WATCH_CHECK_MS + 1);
    });
    expect(row()?.status).toBe("failed");
    expect(row()?.outcome).toBe("unavailable");
    const first = cards(h.hook.result.current.state.messages).find((c) => c.id === watchCard!.id);
    expect(first?.state).toBe("resolved");
    expect(first?.result).toBe(CHAT.checkFailed);
    // A second check, from a new card, stays running through the state that reads checking and resolves on the one after it.
    act(() => h.hook.result.current.controller.send("Check again please"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const second = cards(h.hook.result.current.state.messages).filter((c) => c.card.kind === "watch").at(-1);
    expect(second?.id).not.toBe(watchCard!.id);
    act(() => h.hook.result.current.controller.primary(second!.id));
    expect(h.watch.checkNow).toHaveBeenCalledTimes(2);
    const row2 = () => h.hook.result.current.extras[second!.id]?.[0];
    h.holder.watch = fakeWatchState({ checking: true });
    h.hook.rerender();
    expect(row2()?.status).toBe("running");
    h.holder.watch = fakeWatchState({ checking: false });
    h.hook.rerender();
    expect(row2()?.status).toBe("done");
    expect(cards(h.hook.result.current.state.messages).find((c) => c.id === second!.id)?.result).toBe(WATCH.checkedJustNow);
  });
});

describe("useChat: the fixes of the review", () => {
  it("an exact draft sends once and is consumed: a plan rebuild adds no call and the field stays empty", async () => {
    const h = harness();
    h.holder.consume = vi.fn((seq: number) => {
      if (h.holder.draft?.seq === seq) h.holder.draft = null;
    });
    h.holder.watch = fakeWatchState({ rating: "act_now", items: [ACT_ITEM] });
    h.hook.rerender();
    const exact = askWhyQuestion(FISHY.noticed.headline.persistence);
    h.holder.draft = { text: exact, seq: 7 };
    h.hook.rerender();
    await waitFor(() => expect(h.explainer.calls).toHaveLength(1));
    expect(h.holder.consume).toHaveBeenCalledWith(7);
    expect(h.hook.result.current.state.draft).toBeNull();
    await waitFor(() => expect(h.hook.result.current.state.stream.kind).toBe("idle"));
    (h.bridge as { plan: GuidedPlan }).plan = { ...h.plan };
    h.hook.rerender();
    h.hook.rerender();
    expect(h.explainer.calls).toHaveLength(1);
  });

  it("Try again on the notice resends the typed question, not the chip pressed since", async () => {
    const h = harness({ fail: "timeout" });
    act(() => h.hook.result.current.controller.send("hello there"));
    await waitFor(() => expect(h.hook.result.current.state.stream.kind).toBe("idle"));
    act(() => h.hook.result.current.controller.chip("show_list"));
    act(() => h.hook.result.current.controller.chip("try_again"));
    await waitFor(() => expect(h.explainer.calls).toHaveLength(2));
    expect(h.explainer.calls[1]?.input.question).toBe("hello there");
  });

  it("an accept card whose rule left the allow-lists goes stale at the tap and writes nothing", () => {
    const h = harness();
    act(() => h.hook.result.current.controller.send("I know about the disk"));
    const accept = cards(h.hook.result.current.state.messages).find((c) => c.card.kind === "accept")!;
    h.control.done = ["show:TL-MAC-001"];
    act(() => h.hook.result.current.controller.primary(accept.id));
    expect(h.bridge.accept).not.toHaveBeenCalled();
    expect(cards(h.hook.result.current.state.messages).find((c) => c.id === accept.id)?.state).toBe("stale");
  });

  it("Do this later on a failed card snoozes once and resolves it; Next on an unreadable failure leaves it alone once", async () => {
    const h = harness();
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => h.hook.result.current.controller.primary(live.id));
    h.control.settled = { step: live.step!, outcome: "did_not_change", state: { kind: "failed", error: "command_failed", step: null, batch: false } };
    h.holder.scan = { ...h.holder.scan };
    h.hook.rerender();
    await waitFor(() => expect(cards(h.hook.result.current.state.messages).find((c) => c.id === live.id)?.state).toBe("failed"));
    act(() => h.hook.result.current.controller.link(live.id));
    act(() => h.hook.result.current.controller.link(live.id));
    expect(h.bridge.later).toHaveBeenCalledTimes(1);
    const after = cards(h.hook.result.current.state.messages).find((c) => c.id === live.id);
    expect(after?.state).toBe("resolved");
    expect(after?.result).toBe(LATER_FLASH);
    const g = harness();
    const fix = cards(g.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => g.hook.result.current.controller.primary(fix.id));
    g.control.settled = { step: fix.step!, outcome: "could_not_check", state: { kind: "failed", error: "unreadable", step: null, batch: false } };
    g.holder.scan = { ...g.holder.scan };
    g.hook.rerender();
    await waitFor(() => expect(cards(g.hook.result.current.state.messages).find((c) => c.id === fix.id)?.state).toBe("failed"));
    act(() => g.hook.result.current.controller.primary(fix.id));
    act(() => g.hook.result.current.controller.primary(fix.id));
    expect(g.bridge.leaveAlone).toHaveBeenCalledTimes(1);
    expect(cards(g.hook.result.current.state.messages).find((c) => c.id === fix.id)?.state).toBe("resolved");
  });

  it("events age by turns: noted since the last reply reads 0, one turn later 1", async () => {
    const h = harness();
    act(() => h.hook.result.current.controller.send("first"));
    await waitFor(() => expect(h.hook.result.current.state.stream.kind).toBe("idle"));
    act(() => h.hook.result.current.controller.chip("check_again"));
    act(() => h.hook.result.current.controller.send("second"));
    await waitFor(() => expect(h.hook.result.current.state.stream.kind).toBe("idle"));
    expect(h.explainer.calls[1]?.input.events[0]?.turnsAgo).toBe(0);
    act(() => h.hook.result.current.controller.send("third"));
    await waitFor(() => expect(h.explainer.calls).toHaveLength(3));
    expect(h.explainer.calls[2]?.input.events[0]?.turnsAgo).toBe(1);
  });

  it("What is urgent? reads as one sentence with the why under it; Why? on a batch card is not offered and asks nothing", () => {
    const h = harness();
    act(() => h.hook.result.current.controller.chip("what_is_urgent"));
    const app = [...h.hook.result.current.state.messages].reverse().find((m) => m.kind === "app");
    expect(app?.kind === "app" && app.headline).toBe(`${CHAT.urgentLead} ${guidedFor("TL-MAC-001").headline}.`);
    expect(app?.kind === "app" && app.body).toBe(guidedFor("TL-MAC-001").why);
    act(() => h.hook.result.current.controller.chip("fix_what_you_can"));
    expect(h.hook.result.current.chips.map((c) => c.id)).not.toContain("why");
    act(() => h.hook.result.current.controller.chip("why"));
    expect(h.explainer.calls).toHaveLength(0);
  });

  it("Show me the list draws one row per rule, no paywall or permission row, and the locked count as a line", () => {
    const h = harness({}, false);
    act(() => h.hook.result.current.controller.chip("show_list"));
    const { messages } = h.hook.result.current.state;
    const rows = messages.filter((m): m is Extract<ChatMessage, { kind: "row" }> => m.kind === "row");
    expect(rows.every((r) => r.seed.card.kind !== "lock" && r.seed.card.kind !== "permission")).toBe(true);
    expect(rows.some((r) => r.headline.startsWith("There are"))).toBe(false);
    expect(rows.some((r) => r.headline === guidedFor("TL-MAC-002").headline)).toBe(true);
    const list = [...messages].reverse().find((m) => m.kind === "app");
    expect(list?.kind === "app" && list.body).toMatch(/more in the full version\.$/);
  });

  it("the lock card waits for the free show step, lands once, and What's next? never lands a second one", async () => {
    const h = harness({}, false);
    act(() => h.hook.result.current.controller.chip("show_list"));
    const firewall = h.hook.result.current.state.messages.find((m) => m.kind === "row" && m.headline === guidedFor("TL-MAC-002").headline)!;
    act(() => h.hook.result.current.controller.promote(firewall.id));
    const fix = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => h.hook.result.current.controller.primary(fix.id));
    h.control.done = [fix.step!.id];
    h.control.settled = { step: fix.step!, outcome: "fixed", state: { kind: "done", line: "Done.", rows: [] } };
    h.holder.scan = { ...h.holder.scan };
    h.hook.rerender();
    await waitFor(() => expect(h.hook.result.current.state.working).toBeNull());
    expect(cards(h.hook.result.current.state.messages).some((c) => c.card.kind === "lock")).toBe(false);
    const disk = h.plan.steps.find((s) => s.kind === "show" && s.ruleId === "TL-MAC-001")!;
    const diskCard = cards(h.hook.result.current.state.messages).find((c) => c.step?.id === disk.id);
    h.control.done = h.plan.steps.filter((s) => s.kind !== "paywall").map((s) => s.id);
    act(() => h.hook.result.current.controller.link(diskCard?.id ?? ""));
    act(() => h.hook.result.current.controller.afterSettle());
    expect(cards(h.hook.result.current.state.messages).filter((c) => c.card.kind === "lock")).toHaveLength(1);
    act(() => h.hook.result.current.controller.chip("whats_next"));
    expect(cards(h.hook.result.current.state.messages).filter((c) => c.card.kind === "lock")).toHaveLength(1);
    expect(h.hook.result.current.state.messages.some((m) => m.kind === "app" && m.label === "end")).toBe(true);
  });

  it("the end message after deferring the only step says the Mac is safer and lists it as still waiting", () => {
    const h = harness();
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    vi.mocked(h.bridge.endPlan).mockReturnValue({ ...h.plan, later: ["TL-MAC-001"] });
    h.control.done = h.plan.steps.map((s) => s.id);
    act(() => h.hook.result.current.controller.link(live.id));
    const end = h.hook.result.current.state.messages.at(-1);
    expect(end?.kind === "app" && end.headline).toBe(END.partial);
    expect(end?.kind === "app" && end.groups[0]?.label).toBe(END.waiting);
    expect(end?.kind === "app" && end.groups[0]?.rows[0]?.text).toBe(guidedFor("TL-MAC-001").headline);
  });

  it("a Check now stays running through a state that never read checking", async () => {
    vi.useFakeTimers();
    const h = harness({ result: { ok: true, value: { reply: "The watch is on.", relatedRuleIds: [], outsideScope: false, intents: [{ kind: "open_watch", ruleId: null }], locked: [] } } });
    act(() => h.hook.result.current.controller.send("Is the watch on?"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const watchCard = cards(h.hook.result.current.state.messages).find((c) => c.card.kind === "watch")!;
    act(() => h.hook.result.current.controller.primary(watchCard.id));
    const row = () => h.hook.result.current.extras[watchCard.id]?.[0];
    h.holder.watch = fakeWatchState({ checking: false, nextCheckAt: "2026-10-16T11:00:00.000Z" });
    h.hook.rerender();
    expect(row()?.status).toBe("running");
    h.holder.watch = fakeWatchState({ checking: true });
    h.hook.rerender();
    h.holder.watch = fakeWatchState({ checking: false });
    h.hook.rerender();
    expect(row()?.status).toBe("done");
  });

  it("under reduced motion partials land at most every 400 ms", async () => {
    vi.useFakeTimers();
    window.__talosDemoPace = 0;
    const h = harness({ hold: true });
    act(() => h.hook.result.current.controller.send("Why?"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(h.explainer.calls).toHaveLength(1);
    const text = () => h.hook.result.current.state.messages.find((m) => m.kind === "model")?.kind === "model" && (h.hook.result.current.state.messages.find((m) => m.kind === "model") as Extract<ChatMessage, { kind: "model" }>).text;
    const onPartial = h.explainer.onPartial;
    act(() => onPartial?.({ reply: "a" }));
    expect(text()).toBe("a");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      onPartial?.({ reply: "ab" });
      await vi.advanceTimersByTimeAsync(100);
      onPartial?.({ reply: "abc" });
    });
    expect(text()).toBe("a");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_REDUCED_PARTIAL_MS);
    });
    expect(text()).toBe("abc");
    h.explainer.settle();
  });

  it("ten partials 100 ms apart render ten distinct lengths, each within the 80 ms floor; the block and caret are there from the send", async () => {
    vi.useFakeTimers();
    const h = harness({ hold: true });
    act(() => h.hook.result.current.controller.send("Why?"));
    const model = () => h.hook.result.current.state.messages.find((m) => m.kind === "model") as Extract<ChatMessage, { kind: "model" }> | undefined;
    // person_sent: the block exists with the caret and no text, and the spiral's writing flag is up.
    expect(model()).toMatchObject({ text: "", streaming: true });
    expect(h.hook.result.current.busy).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.explainer.onPartial).not.toBeNull();
    const lengths: number[] = [];
    let reply = "";
    for (let i = 0; i < 10; i += 1) {
      reply += `word${i} `;
      const partial = reply;
      await act(async () => {
        h.explainer.onPartial?.({ reply: partial });
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(model()?.text).toBe(partial);
      lengths.push(model()?.text.length ?? 0);
    }
    expect(new Set(lengths).size).toBe(10);
    expect(model()?.streaming).toBe(true);
    expect(h.hook.result.current.busy).toBe(true);
    h.explainer.settle();
  });
});

/* AGENT part B region (docs/DESIGN-AGENT.md section 6, desktop): reminders, the write-up, the what-if, the walk's checklist, the gated lines. */
describe("useChat: agent", () => {
  const app = (messages: readonly ChatMessage[], label: string) => messages.filter((m): m is Extract<ChatMessage, { kind: "app" }> => m.kind === "app" && m.label === label);
  const clipboard = (ok: boolean) => {
    const writeText = vi.fn(async () => {
      if (!ok) throw new Error("denied");
    });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    return writeText;
  };

  it("Ask me again tomorrow after Do this later reminds through the bridge, answers the line, and makes no call", () => {
    const h = harness();
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => h.hook.result.current.controller.link(live.id));
    expect(h.hook.result.current.chips.map((c) => c.label)).toEqual([ACTIVITY.chips.remindTomorrow, ACTIVITY.chips.whatIf, CHAT.chips.whatsNext, CHAT.chips.showList]);
    // The snooze settled the step, so allowed.remind no longer lists it; the declined card is still the chip's target.
    h.control.done = [live.step!.id];
    act(() => h.hook.result.current.controller.chip("remind_tomorrow"));
    expect(h.bridge.remind).toHaveBeenCalledWith(live.step, "tomorrow");
    const remind = app(h.hook.result.current.state.messages, "remind").at(-1);
    expect(remind?.headline).toBe(ACTIVITY.chips.remindTomorrow);
    expect(remind?.body).toBe(ACTIVITY.remind.tomorrow.replace("{headline}", guidedFor("TL-MAC-001").headline));
    expect(h.explainer.calls).toHaveLength(0);
    const sunday = new Date(reminderDate(new Date(2026, 9, 18, 12).toISOString(), "sunday"));
    expect([sunday.getDate(), sunday.getDay(), sunday.getHours()]).toEqual([25, 0, REMINDER_HOUR]);
  });

  it("the typed Sunday form collapses the live card to the line and names the rule it resolved; a due reminder renders the lead once", () => {
    const h = harness();
    act(() => h.hook.result.current.controller.send("remind me on Sunday about the firewall"));
    const step = h.plan.steps.find((s) => s.kind === "batch")!;
    expect(h.bridge.remind).toHaveBeenCalledWith(step, "sunday");
    expect(app(h.hook.result.current.state.messages, "remind").at(-1)?.body).toBe(ACTIVITY.remind.sunday.replace("{headline}", guidedFor("TL-MAC-002").headline));
    expect(h.explainer.calls).toHaveLength(0);
    cleanup();
    const plan = planFor(true);
    const { bridge } = fakeBridge(plan, { reminders: ["TL-MAC-002"] });
    const explainer = scriptedExplainer();
    const adapters = fakeAdapters({ createExplainer: vi.fn(async () => explainer.port) });
    const wrapper = ({ children }: { children: ReactNode }) => {
      const base = fakeContextValue({ adapters, license: { status: "none" }, gate: { licensed: true, freeFixes: plan.freeFixes, has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false }, scanState: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null }, settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" } } });
      return createElement(AppContext.Provider, { value: base }, createElement(WatchControllerContext.Provider, { value: { ...fakeWatchController(), state: fakeWatchState() } }, children));
    };
    const hook = renderHook(() => useChat(bridge), { wrapper });
    const opening = hook.result.current.state.messages[0];
    expect(opening?.kind === "app" && opening.lead).toBe(ACTIVITY.remind.due.replace("{headline}", guidedFor("TL-MAC-002").headline));
    expect(hook.result.current.state.messages.filter((m) => m.kind === "app" && m.lead !== null)).toHaveLength(1);
  });

  it("Write this up renders authored text with no Where: and no slash; Copy it writes it to the clipboard, and the fallback line appears when it refuses", async () => {
    const writeText = clipboard(true);
    const h = harness();
    act(() => h.hook.result.current.controller.chip("write_up"));
    const card = cards(h.hook.result.current.state.messages).find((c) => c.card.kind === "write_up")!;
    expect(card.live).toBe(true);
    expect(card.writeUpText).toContain("Talos Labs check-up");
    expect(card.writeUpText).toContain(guidedFor("TL-MAC-001").headline);
    expect(card.writeUpText).not.toContain("Where:");
    expect(card.writeUpText).not.toContain("/");
    expect(card.writeUpText).not.toContain("TL-MAC");
    expect(h.explainer.calls).toHaveLength(0);
    act(() => h.hook.result.current.controller.primary(card.id));
    await waitFor(() => expect(cards(h.hook.result.current.state.messages).find((c) => c.id === card.id)?.copiedAt).not.toBeNull());
    expect(writeText).toHaveBeenCalledWith(card.writeUpText);
    expect(h.hook.result.current.state.announce.text).toBe(ACTIVITY.writeUp.copied);
    cleanup();
    clipboard(false);
    const g = harness();
    act(() => g.hook.result.current.controller.send("write this up for my son"));
    const again = cards(g.hook.result.current.state.messages).find((c) => c.card.kind === "write_up")!;
    act(() => g.hook.result.current.controller.primary(again.id));
    await waitFor(() => expect(g.hook.result.current.state.messages.at(-1)).toMatchObject({ kind: "notice", text: ACTIVITY.writeUp.copyFailed }));
    expect(g.explainer.calls).toHaveLength(0);
  });

  it("the what-if answer reads the why first and the cost second, lands the step's card, and offers Leave it alone", () => {
    const h = harness();
    act(() => h.hook.result.current.controller.send("what if I leave the disk alone?"));
    const answer = app(h.hook.result.current.state.messages, "what_if").at(-1)!;
    const points = REPORT.results.find((r) => r.ruleId === "TL-MAC-001")?.points ?? 0;
    expect(answer.body?.split("\n")).toEqual([guidedFor("TL-MAC-001").why, ACTIVITY.whatIf.cost.replace("{p}", String(points)), ACTIVITY.whatIf.critical]);
    expect(cards(h.hook.result.current.state.messages).find((c) => c.live)?.step?.id).toBe("show:TL-MAC-001");
    expect(h.hook.result.current.chips.map((c) => c.label)).toEqual([CHAT.chips.leaveAlone, CHAT.chips.whatsNext, CHAT.chips.showList]);
    expect(h.explainer.calls).toHaveLength(0);
  });

  it("Do them all draws the progress line, three visible rows and the rest as a count; a result ticks its row; a tapped row steps up; a show card waits", async () => {
    vi.useFakeTimers();
    const h = harness();
    act(() => h.hook.result.current.controller.chip("do_them_all"));
    const walk = () => app(h.hook.result.current.state.messages, "walk").at(-1)?.checklist ?? null;
    expect(walk()?.done).toBe(0);
    expect(walk()!.of).toBeGreaterThan(3);
    const visible = visibleWalkRows(walk()!);
    const running = visible.rows.filter((r) => r.icon === "running").length;
    expect(running).toBeGreaterThan(0);
    expect(visible.rows).toHaveLength(running + 2);
    expect(visible.more).toBe(walk()!.of - running - 2);
    expect(visible.rows[0]?.icon).toBe("running");
    const batch = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    expect(batch.card.kind).toBe("batch");
    act(() => h.hook.result.current.controller.promoteStep("show:TL-MAC-001"));
    expect(cards(h.hook.result.current.state.messages).find((c) => c.live)?.step?.id).toBe("show:TL-MAC-001");
    expect(walk()?.rows.find((r) => r.stepId === "show:TL-MAC-001")?.icon).toBe("running");
    expect(walk()?.rows.find((r) => r.stepId === "batch")?.icon).toBe("pending");
    act(() => h.hook.result.current.controller.promoteStep("batch"));
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    expect(live.step?.id).toBe("batch");
    act(() => h.hook.result.current.controller.primary(live.id));
    const ids = live.card.ruleIds;
    h.control.settled = { step: live.step!, outcome: "fixed", state: { kind: "done", line: "Done.", rows: ids.map((ruleId) => ({ ruleId, ok: true, text: "x" })) } };
    h.control.done = ["batch"];
    h.holder.scan = { ...h.holder.scan };
    h.hook.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(walk()?.done).toBe(ids.length);
    expect(h.hook.result.current.state.announce.text).toBe(`${ids.length} of ${walk()!.of} done`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    // The walk moved on from the row after the batch; a tapped show row steps up and then waits on the person.
    const after = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    expect(after.step?.id).toBe(h.plan.steps.filter((s) => s.kind !== "paywall" && s.id !== "batch")[0]?.id);
    act(() => h.hook.result.current.controller.promoteStep("show:TL-MAC-001"));
    const show = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    expect(show.card.kind).toBe("show");
    act(() => h.hook.result.current.controller.primary(show.id));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.hook.result.current.state.working).toBe(show.id);
    expect(walk()?.rows.find((r) => r.stepId === show.step?.id)?.icon).toBe("running");
    expect(h.explainer.calls).toHaveLength(0);
  });

  it("typed look-into on a check-up item runs the recheck; with no item it answers the gated line; closer offers Settings; no call", () => {
    const h = harness();
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => h.hook.result.current.controller.send("look into this"));
    expect(h.bridge.checkAgain).toHaveBeenCalledWith(live.step);
    expect(h.hook.result.current.state.messages.some((m) => m.kind === "notice")).toBe(false);
    // The write-up card names no rule, so the bare form has nothing on this Mac to recheck.
    act(() => h.hook.result.current.controller.chip("write_up"));
    act(() => h.hook.result.current.controller.send("look into this"));
    expect(h.hook.result.current.state.messages.at(-1)).toMatchObject({ kind: "notice", text: ACTIVITY.refuse.lookNotYet, wayOut: null });
    act(() => h.hook.result.current.controller.send("watch closer for an hour"));
    expect(h.hook.result.current.state.messages.at(-1)).toMatchObject({ kind: "notice", text: ACTIVITY.refuse.closerNotYet, wayOut: { kind: "link", label: ACTIVITY.links.settings } });
    expect(h.explainer.calls).toHaveLength(0);
    expect(h.hook.result.current.chips.length).toBeLessThanOrEqual(4);
    const free = harness({}, false);
    act(() => free.hook.result.current.controller.send("look into this"));
    expect(free.hook.result.current.state.messages.at(-1)).toMatchObject({ kind: "notice", text: ACTIVITY.refuse.full_version_recheck });
    expect(free.bridge.checkAgain).not.toHaveBeenCalled();
    for (const chip of ["show_list", "whats_next", "write_up"] as const) {
      act(() => free.hook.result.current.controller.chip(chip));
      expect(free.hook.result.current.chips.length).toBeLessThanOrEqual(4);
    }
  });

  it("a typed reminder with the live card idle collapses the card to the reminder line with no second message, and a batch card is a target", () => {
    const h = harness();
    act(() => h.hook.result.current.controller.chip("fix_what_you_can"));
    const batch = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    expect(batch.card.kind).toBe("batch");
    act(() => h.hook.result.current.controller.send("ask me tomorrow"));
    expect(h.bridge.remind).toHaveBeenCalledWith(batch.step, "tomorrow");
    const first = batch.card.ruleIds[0]!;
    const body = ACTIVITY.remind.tomorrow.replace("{headline}", guidedFor(first).headline);
    expect(cards(h.hook.result.current.state.messages).find((c) => c.id === batch.id)).toMatchObject({ state: "resolved", outcome: "snoozed", result: body });
    expect(app(h.hook.result.current.state.messages, "remind")).toHaveLength(0);
    expect(h.explainer.calls).toHaveLength(0);
  });

  it("a reminder never names a rule outside allowed.remind: an accepted rule or one just fixed", async () => {
    const h = harness({}, true, { ...EMPTY_GUIDED_MEMORY, accepted: { "TL-MAC-001": "2026-10-10T09:00:00.000Z" } }, EMPTY_GUIDED_MEMORY);
    expect(cards(h.hook.result.current.state.messages).find((c) => c.live)?.card.ruleId).toBe("TL-MAC-001");
    act(() => h.hook.result.current.controller.send("Ask me again tomorrow"));
    expect(h.bridge.remind).not.toHaveBeenCalled();
    expect(h.bridge.remindRules).not.toHaveBeenCalled();
    act(() => h.hook.result.current.controller.send("remind me tomorrow"));
    expect(h.bridge.remind).not.toHaveBeenCalled();
    await waitFor(() => expect(h.hook.result.current.state.stream.kind).toBe("idle"));
    const g = harness();
    const live = cards(g.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => g.hook.result.current.controller.primary(live.id));
    g.control.settled = { step: live.step!, outcome: "fixed", state: { kind: "done", line: "Done.", rows: [] } };
    g.control.done = [live.step!.id];
    g.holder.scan = { ...g.holder.scan };
    g.hook.rerender();
    await waitFor(() => expect(g.hook.result.current.state.working).toBeNull());
    act(() => g.hook.result.current.controller.send("ask me again tomorrow"));
    expect(g.bridge.remind).not.toHaveBeenCalled();
    expect(app(g.hook.result.current.state.messages, "remind")).toHaveLength(0);
  });

  it("a model reminder for a later id with no step writes the dates through remindRules and renders the line", async () => {
    const memory: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, snoozed: { "TL-MAC-010": "2026-12-01T00:00:00.000Z" } };
    const h = harness({ result: { ok: true, value: { reply: "Sunday it is.", relatedRuleIds: [], outsideScope: false, intents: [{ kind: "remind_rule", ruleId: "TL-MAC-010", signalId: null, when: "sunday" }], locked: [] } } }, true, memory);
    expect(h.plan.later).toEqual(["TL-MAC-010"]);
    act(() => h.hook.result.current.controller.send("Could you bring the screen lock up on Sunday?"));
    await waitFor(() => expect(h.hook.result.current.state.stream.kind).toBe("idle"));
    expect(h.bridge.remindRules).toHaveBeenCalledWith(["TL-MAC-010"], "sunday");
    expect(h.bridge.remind).not.toHaveBeenCalled();
    expect(app(h.hook.result.current.state.messages, "remind").at(-1)?.body).toBe(ACTIVITY.remind.sunday.replace("{headline}", guidedFor("TL-MAC-010").headline));
  });

  it("the what-if headline names the item; the write-up title carries the year", () => {
    const h = harness();
    act(() => h.hook.result.current.controller.send("what if I leave the disk alone?"));
    expect(app(h.hook.result.current.state.messages, "what_if").at(-1)?.headline).toBe(ACTIVITY.whatIf.headline.replace("{headline}", guidedFor("TL-MAC-001").headline));
    act(() => h.hook.result.current.controller.chip("write_up"));
    const card = cards(h.hook.result.current.state.messages).find((c) => c.card.kind === "write_up")!;
    expect(card.writeUpText?.split("\n")[0]).toMatch(/^Talos Labs check-up, \d{1,2} [A-Z][a-z]+ \d{4}$/);
  });

  it("Do this later and a typed reminder during Do them all land the next card after the tick and tag the row Another day", async () => {
    vi.useFakeTimers();
    const h = harness();
    act(() => h.hook.result.current.controller.chip("do_them_all"));
    const walk = () => app(h.hook.result.current.state.messages, "walk").at(-1)?.checklist ?? null;
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => h.hook.result.current.controller.link(live.id));
    h.control.done = [live.step!.id];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(autoAdvanceMs(false) + 1);
    });
    const second = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    expect(second.id).not.toBe(live.id);
    expect(second.step?.id).toBe(h.plan.steps.filter((s) => s.kind !== "paywall" && s.id !== live.step!.id)[0]?.id);
    expect(walk()?.rows.find((r) => r.stepId === live.step!.id)?.tag).toBe(ACTIVITY.rows.anotherDay);
    expect(h.hook.result.current.state.walking).toBe(true);
    act(() => h.hook.result.current.controller.send("ask me tomorrow"));
    expect(h.bridge.remind).toHaveBeenCalledWith(second.step, "tomorrow");
    h.control.done = [live.step!.id, second.step!.id];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(autoAdvanceMs(false) + 1);
    });
    const third = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    expect(third.id).not.toBe(second.id);
    expect(third.state).toBe("idle");
    expect(h.explainer.calls).toHaveLength(0);
  });

  it("a row tapped between a result and the walk's tick stays the one live card; the tick lands no second card for it", async () => {
    vi.useFakeTimers();
    const h = harness();
    act(() => h.hook.result.current.controller.chip("do_them_all"));
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => h.hook.result.current.controller.primary(live.id));
    h.control.settled = { step: live.step!, outcome: "fixed", state: { kind: "done", line: "Done.", rows: live.card.ruleIds.map((ruleId) => ({ ruleId, ok: true, text: "x" })) } };
    h.control.done = [live.step!.id];
    h.holder.scan = { ...h.holder.scan };
    h.hook.rerender();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const chosen = h.plan.steps.filter((s) => s.kind !== "paywall" && s.id !== live.step!.id).at(-1)!;
    act(() => h.hook.result.current.controller.promoteStep(chosen.id));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(autoAdvanceMs(false) + 1);
    });
    const { messages } = h.hook.result.current.state;
    expect(messages.filter((m) => (m.kind === "card" && m.step?.id === chosen.id) || (m.kind === "row" && m.seed.step?.id === chosen.id))).toHaveLength(1);
    expect(cards(messages).find((c) => c.live)?.step?.id).toBe(chosen.id);
  });

  it("a model reply naming remind_rule collapses the item's idle card to the reminder line after the model block; one naming investigate is dropped by the validator", async () => {
    const h = harness({ result: { ok: true, value: { reply: "Tomorrow it is.", relatedRuleIds: [], outsideScope: false, intents: [{ kind: "remind_rule", ruleId: "TL-MAC-001", signalId: null, when: "tomorrow" }], locked: [] } } });
    const live = cards(h.hook.result.current.state.messages).find((c) => c.live)!;
    act(() => h.hook.result.current.controller.send("Can you ask me tomorrow instead?"));
    await waitFor(() => expect(h.hook.result.current.state.stream.kind).toBe("idle"));
    const messages = h.hook.result.current.state.messages;
    expect(messages.some((m) => m.kind === "model" && m.text === "Tomorrow it is.")).toBe(true);
    expect(cards(messages).find((c) => c.id === live.id)).toMatchObject({ state: "resolved", outcome: "snoozed", result: ACTIVITY.remind.tomorrow.replace("{headline}", guidedFor("TL-MAC-001").headline) });
    expect(app(messages, "remind")).toHaveLength(0);
    expect(h.bridge.remind).toHaveBeenCalledWith(h.plan.steps.find((s) => s.id === "show:TL-MAC-001"), "tomorrow");
    const allowed = allowedFor(h.plan, true);
    const raw = { reply: "That one is worth a closer look.", relatedRuleIds: [], outsideScope: false, intents: [{ kind: "investigate", ruleId: null, signalId: "sig.persistence_new", when: null }] };
    const validated = validateChat(raw, { results: allowed.details.map((ruleId) => ({ ruleId })) }, allowed, []);
    expect(validated.ok && validated.value.intents).toEqual([]);
    expect(allowed.kinds.includes("investigate")).toBe(WATCH_AGENT_PORTS_READY);
  });
});
