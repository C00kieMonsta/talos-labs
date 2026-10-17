// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { WatchState } from "@talos/core";
import { DEV_MACHINE } from "@talos/core";
import { AppContext } from "../app/context";
import type { AppContextValue } from "../app/context";
import { fakeAdapters, fakeContextValue, fakeWatchController, fakeWatchState } from "../app/testing";
import { CHAT } from "../guided/copy";
import { autoAdvanceMs } from "../guided/timing";
import type { ScanState } from "../scan/machine";
import { DEFAULT_SETTINGS } from "../settings";
import { WatchControllerContext } from "../watch/watch-controller";
import { ChatScreen } from "./ChatScreen";
import { ACT_ITEM, REPORT, fakeBridge, planFor, scriptedExplainer } from "./testing";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The chat screen over a holder the test mutates, then re-renders. */
function mount() {
  const plan = planFor(true);
  const { bridge, control } = fakeBridge(plan);
  const explainer = scriptedExplainer({ hold: true });
  const holder: { scan: ScanState; watch: WatchState | null } = { scan: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null }, watch: fakeWatchState() };
  const adapters = fakeAdapters({ createExplainer: vi.fn(async () => explainer.port) });
  const watch = fakeWatchController();
  const Screen = () => {
    const base = fakeContextValue({
      adapters,
      license: { status: "none" },
      gate: { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false },
      scanState: holder.scan,
      settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" } },
    });
    const value: AppContextValue = { ...base, ai: { ...base.ai, availability: "available" } };
    return createElement(AppContext.Provider, { value }, createElement(WatchControllerContext.Provider, { value: { ...watch, state: holder.watch } }, createElement(ChatScreen, { bridge })));
  };
  const view = render(createElement(Screen));
  return { container: view.container, rerender: () => view.rerender(createElement(Screen)), bridge, control, explainer, holder, plan };
}

const active = () => document.activeElement as HTMLElement | null;
const field = (c: HTMLElement) => c.querySelector("textarea") as HTMLTextAreaElement;
const headlines = (c: HTMLElement) => [...c.querySelectorAll(".chat-headline")] as HTMLElement[];
const chipNamed = (c: HTMLElement, label: string) => [...c.querySelectorAll(".chat-chip")].find((b) => b.textContent === label) as HTMLButtonElement;

describe("ChatScreen focus", () => {
  it("Escape in the field moves to the newest headline; a chip moves to the headline it landed; send and Stop keep the field", async () => {
    vi.useFakeTimers();
    const { container, explainer } = mount();
    field(container).focus();
    fireEvent.keyDown(field(container), { key: "Escape" });
    expect(active()).toBe(headlines(container).at(-1));
    act(() => chipNamed(container, CHAT.chips.fixWhatYouCan).click());
    expect(active()?.classList.contains("chat-card-headline")).toBe(true);
    expect(active()?.textContent).toMatch(/^I can fix/);
    fireEvent.change(field(container), { target: { value: "Why does the disk matter?" } });
    await act(async () => {
      fireEvent.keyDown(field(container), { key: "Enter" });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(active()).toBe(field(container));
    act(() => (container.querySelector(`button[aria-label="${CHAT.stop}"]`) as HTMLButtonElement).click());
    expect(active()).toBe(field(container));
    explainer.settle();
  });

  it("the watch's act-now takes focus whatever had it", () => {
    const h = mount();
    field(h.container).focus();
    h.holder.watch = fakeWatchState({ rating: "act_now", items: [ACT_ITEM] });
    act(() => h.rerender());
    expect(active()?.textContent).toMatch(/^Act now:/);
  });

  it("after a primary settles, the promoted card's headline takes focus; the walk's advance moves it on again", async () => {
    vi.useFakeTimers();
    const h = mount();
    act(() => chipNamed(h.container, CHAT.chips.fixWhatYouCan).click());
    act(() => (h.container.querySelector(".chat-card[data-live='true'] .button-primary") as HTMLButtonElement).click());
    expect(active()?.textContent).toMatch(/^I can fix/);
    h.control.settled = { step: h.plan.steps[0]!, outcome: "fixed", state: { kind: "done", line: "Done. 3 things fixed.", rows: [] } };
    h.holder.scan = { ...h.holder.scan };
    await act(async () => {
      h.rerender();
      await vi.advanceTimersByTimeAsync(1);
    });
    const promoted = h.container.querySelector(".chat-card[data-live='true'] .chat-headline");
    expect(promoted).not.toBeNull();
    expect(active()).toBe(promoted);
    // The walk: "Do them all" lands the first card; its settle schedules the next, which takes focus after the tick.
    cleanup();
    const w = mount();
    act(() => chipNamed(w.container, CHAT.chips.doThemAll).click());
    const first = w.container.querySelector(".chat-card[data-live='true']") as HTMLElement;
    act(() => (first.querySelector(".button-primary") as HTMLButtonElement).click());
    w.control.settled = { step: w.plan.steps[0]!, outcome: "fixed", state: { kind: "done", line: "Done.", rows: [] } };
    w.control.done = [w.plan.steps[0]!.id];
    w.holder.scan = { ...w.holder.scan };
    act(() => w.rerender());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(autoAdvanceMs(false) + 1);
    });
    const next = w.container.querySelector(".chat-card[data-live='true'] .chat-headline");
    expect(next).not.toBeNull();
    expect(next).not.toBe(first.querySelector(".chat-headline"));
    expect(active()).toBe(next);
  });
});
