// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { AppContext } from "../app/context";
import { fakeAdapters, fakeContextValue } from "../app/testing";
import { CHAT } from "../guided/copy";
import { ChatTranscript, exchangesOf } from "./ChatTranscript";
import type { ChatHandlers } from "./handlers";
import { reduce } from "./reduce";
import type { ChatMessage, ChatState } from "./state";
import { AT, REPLY, REPORT, openedAction, planFor, run } from "./testing";
import { DEV_MACHINE } from "@talos/core";

afterEach(cleanup);

const HANDLERS: ChatHandlers = { send: vi.fn(), chip: vi.fn(), primary: vi.fn(), link: vi.fn(), checkAgain: vi.fn(), promote: vi.fn(), stop: vi.fn(), licenceAccepted: vi.fn(), navigate: vi.fn(), draftConsumed: vi.fn() };

function mount(state: ChatState) {
  const value = fakeContextValue({
    adapters: fakeAdapters(),
    license: { status: "none" },
    gate: { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false },
    scanState: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null },
  });
  const logRef = createRef<HTMLDivElement>();
  const tree = createElement(AppContext.Provider, { value }, createElement(ChatTranscript, { messages: state.messages, handlers: HANDLERS, extras: {}, logRef, headlineRef: () => undefined }));
  return render(tree);
}

const PLAN = planFor(true);

describe("ChatTranscript", () => {
  it("is a region named Conversation with no log role and no live region inside it", () => {
    const state = run([openedAction(PLAN), { type: "person_sent", at: AT, text: "Why?", turnId: "t1" }, { type: "model_partial", at: AT, turnId: "t1", text: "Because" }]);
    const { container } = mount(state);
    const log = container.querySelector(".chat");
    expect(log?.getAttribute("role")).toBe("region");
    expect(log?.getAttribute("aria-label")).toBe(CHAT.conversation);
    expect(container.querySelector("[role='log']")).toBeNull();
    expect(container.querySelector("[role='status']")).toBeNull();
    for (const el of container.querySelectorAll("[aria-live]")) expect(el.getAttribute("aria-live")).toBe("off");
  });

  it("groups turns into exchanges labelled by the person's words or Talos Labs, with the model's badge under its text", () => {
    const state = run([openedAction(PLAN), { type: "person_sent", at: AT, text: "Why does the disk matter?", turnId: "t1" }, { type: "model_ready", at: AT, turnId: "t1", result: REPLY, cards: [], related: [], lockedMeta: null }]);
    const { container } = mount(state);
    const labels = [...container.querySelectorAll("section.chat-exchange")].map((s) => s.getAttribute("aria-label"));
    expect(labels).toEqual([CHAT.exchangeApp, `${CHAT.exchangeYou} Why does the disk matter?`]);
    expect(container.querySelectorAll(".guided-model .chat-badge")).toHaveLength(1);
    expect(container.querySelector(".chat-person")?.textContent).toBe("Why does the disk matter?");
  });

  it("draws one divider after a gap over ten minutes and none under it", () => {
    const base = run([openedAction(PLAN)]);
    const soon = reduce(base, { type: "person_sent", at: AT + 600_000, text: "hi", turnId: "t1" });
    expect(mount(soon).container.querySelectorAll(".chat-divider")).toHaveLength(0);
    cleanup();
    const later = reduce(base, { type: "person_sent", at: AT + 600_001, text: "hi", turnId: "t2" });
    expect(mount(later).container.querySelectorAll(".chat-divider")).toHaveLength(1);
  });

  it("exchangesOf starts a new exchange at a person turn, the end message and the watch card only", () => {
    const messages: readonly ChatMessage[] = run([openedAction(PLAN), { type: "end_reached", at: AT, title: "Done.", body: null, groups: [], brief: null }]).messages;
    expect(exchangesOf(messages).map((e) => e.messages.length)).toEqual([2, 1]);
  });
});
