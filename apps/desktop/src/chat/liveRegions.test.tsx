// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { DEV_MACHINE } from "@talos/core";
import { AppContext } from "../app/context";
import type { AppContextValue } from "../app/context";
import { fakeAdapters, fakeContextValue } from "../app/testing";
import { CHAT } from "../guided/copy";
import { DEFAULT_SETTINGS } from "../settings";
import { ChatScreen } from "./ChatScreen";
import { REPORT, fakeBridge, planFor, scriptedExplainer } from "./testing";
import type { ScriptedChat } from "./testing";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(script: ScriptedChat) {
  const { bridge } = fakeBridge(planFor(true));
  const explainer = scriptedExplainer(script);
  const base = fakeContextValue({
    adapters: fakeAdapters({ createExplainer: vi.fn(async () => explainer.port) }),
    license: { status: "none" },
    gate: { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false },
    scanState: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null },
    settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" } },
  });
  const value: AppContextValue = { ...base, ai: { ...base.ai, availability: "available" } };
  const view = render(createElement(AppContext.Provider, { value }, createElement(ChatScreen, { bridge })));
  return { ...view, explainer };
}

function live(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("[aria-live], [role='status'], [role='log'], [role='alert']")].filter((el) => el.getAttribute("aria-live") !== "off");
}

describe("the chat's live regions", () => {
  it("has exactly one, the status element outside the log, and the log's text does not change while a model block streams", async () => {
    vi.useFakeTimers();
    const { container, explainer } = mount({ partials: ["The disk", "The disk matters.", "The disk matters. A lost bag."], hold: true });
    const regions = live(container);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.classList.contains("chat-status")).toBe(true);
    expect(container.querySelector(".chat")?.contains(regions[0] ?? null)).toBe(false);
    const field = container.querySelector("textarea") as HTMLTextAreaElement;
    const status = () => regions[0]?.textContent?.trim();
    fireEvent.change(field, { target: { value: "Why does the disk matter?" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(status()).toBe(CHAT.writing);
    const before = status();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(container.querySelector(".guided-model .model-text")?.textContent).toContain("The disk");
    expect(status()).toBe(before);
    expect(live(container)).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8000);
    });
    expect(status()).toBe(CHAT.stillWaiting.chatgpt);
    const stop = container.querySelector(`button[aria-label="${CHAT.stop}"]`) as HTMLButtonElement;
    act(() => stop.click());
    expect(status()).toBe(CHAT.stopped);
    expect(container.querySelector(".guided-model")).toBeNull();
    explainer.settle();
  });

  it("announces the opening headline and the result of a chip, and the strip holds Step by step", () => {
    const { container } = mount({});
    const status = container.querySelector(".chat-status");
    expect(status?.textContent?.trim()).toMatch(/^I found/);
    const chip = [...container.querySelectorAll(".chat-chip")].find((b) => b.textContent === CHAT.chips.showList) as HTMLButtonElement;
    act(() => chip.click());
    expect(status?.textContent?.trim()).toBe(CHAT.list);
    // The opening's live card keeps the one primary; the list is rows.
    expect(container.querySelectorAll(".chat-card .button-primary")).toHaveLength(1);
    expect(container.querySelectorAll(".chat-row").length).toBeGreaterThan(1);
    expect([...container.querySelectorAll(".guided-strip-link")].map((b) => b.textContent)).toEqual([]);
  });
});
