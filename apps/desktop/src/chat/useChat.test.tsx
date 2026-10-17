// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { AiAvailability, WatchState } from "@talos/core";
import { DEV_MACHINE } from "@talos/core";
import { AppContext } from "../app/context";
import type { AppContextValue } from "../app/context";
import { fakeAdapters, fakeContextValue, fakeWatchController, fakeWatchState } from "../app/testing";
import { CHAT, EXPLAIN, FISHY, LATER_FLASH } from "../guided/copy";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import type { ScanState } from "../scan/machine";
import { WatchControllerContext } from "../watch/watch-controller";
import { ChatDraftContext } from "./draft";
import type { ChatDraft } from "./draft";
import type { ChatMessage } from "./state";
import { ACT_ITEM, REPORT, fakeBridge, planFor, scriptedExplainer } from "./testing";
import type { ScriptedChat } from "./testing";
import { CHAT_STILL_WAITING_MS, CHAT_WATCH_CHECK_MS, useChat } from "./useChat";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

interface Holder {
  scan: ScanState;
  availability: AiAvailability | null;
  watch: WatchState | null;
  draft: ChatDraft | null;
  licensed: boolean;
}

function harness(script: ScriptedChat = {}, licensed = true) {
  const plan = planFor(licensed);
  const { bridge, control } = fakeBridge(plan);
  const explainer = scriptedExplainer(script);
  const holder: Holder = { scan: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null }, availability: "available", watch: fakeWatchState(), draft: null, licensed };
  const adapters = fakeAdapters({ createExplainer: vi.fn(async () => explainer.port) });
  const watch = fakeWatchController();
  const wrapper = ({ children }: { children: ReactNode }) => {
    const settings: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" }, watch: { ...DEFAULT_SETTINGS.watch, enabled: true } };
    const base = fakeContextValue({ adapters, license: { status: "none" }, gate: { licensed: holder.licensed, freeFixes: plan.freeFixes, has: () => holder.licensed, fixLocked: () => !holder.licensed, explainLocked: () => false, watchLocked: !holder.licensed }, scanState: holder.scan, settings });
    const value: AppContextValue = { ...base, ai: { ...base.ai, availability: holder.availability } };
    return createElement(AppContext.Provider, { value }, createElement(WatchControllerContext.Provider, { value: { ...watch, state: holder.watch } }, createElement(ChatDraftContext.Provider, { value: holder.draft }, children)));
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
    expect(chips.map((c) => c.label)).toEqual([CHAT.chips.doThemAll, CHAT.chips.fixWhatYouCan, CHAT.chips.showList]);
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
    const exact = CHAT.askWhy.replace("{headline}", FISHY.noticed.headline.persistence);
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_WATCH_CHECK_MS + 1);
    });
    expect(row()?.status).toBe("failed");
    expect(row()?.outcome).toBe("unavailable");
    // A second check resolves on the next watch:state, whichever way it reads.
    act(() => h.hook.result.current.controller.primary(watchCard!.id));
    expect(h.explainer.calls).toHaveLength(1);
    h.holder.watch = fakeWatchState({ checking: true });
    h.hook.rerender();
    expect(row()?.status).toBe("done");
  });
});
