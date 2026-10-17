import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode, createElement, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AiAvailability, Explanation, ScanReport } from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { AI_UNAVAILABLE_COPY, EXPLAINER_FAILURE_LABELS } from "../app/labels";
import { REPROBE_SETTINGS_MS } from "../scan/useAiAvailability";
import { StatefulProvider, fakeAdapters, fakeConnectController, fakeContextValue } from "../app/testing";
import type { AppContextValue } from "../app/context";
import type { AiConnectController } from "../scan/ai-connect";
import type { ExplainState } from "../scan/machine";
import { DEFAULT_SETTINGS } from "../settings";
import type { ExplainerProvider } from "../settings";
import { ExplainPanel } from "./ExplainPanel";
import { EXPLAIN } from "./copy";

afterEach(cleanup);

const REPORT: ScanReport = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-16T10:00:00.000Z", os: "macos" });
const RULE = "TL-MAC-001";
const EXPLANATION: Explanation = { ruleId: RULE, whyItMattersForYou: "Anyone on the same network can reach your Mac.", whatCouldHappen: "They could connect.", urgency: "today" };

interface Options {
  readonly availability?: AiAvailability | null;
  readonly until?: string | null;
  readonly provider?: ExplainerProvider;
  readonly explain?: ExplainState;
  readonly locked?: boolean;
  readonly connect?: Partial<AiConnectController>;
  readonly others?: readonly (typeof RULE)[];
  readonly onUnlock?: () => void;
}

function renderPanel(options: Options = {}) {
  const locked = options.locked === true;
  const base = fakeContextValue({
    adapters: fakeAdapters(),
    license: { status: "none" },
    gate: { licensed: !locked, freeFixes: [], has: () => !locked, fixLocked: () => locked, explainLocked: () => locked },
    scanState: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: options.explain ?? { kind: "off" }, lastRecheck: null, fixing: null, watching: null },
    settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: options.provider ?? "chatgpt" } },
  });
  const value: AppContextValue = { ...base, ai: { ...base.ai, availability: options.availability === undefined ? "available" : options.availability, until: options.until ?? null, probe: vi.fn(async () => "available" as const), reprobe: vi.fn(() => () => undefined) } };
  const connect = fakeConnectController({ offered: { chatgpt: true, claude_plan: true, apple: false }, connectable: true, ...options.connect });
  render(createElement(StatefulProvider, { value, connect }, createElement(ExplainPanel, { ruleId: RULE, others: options.others, onUnlock: options.onUnlock })));
  return { value, connect };
}

function open() {
  fireEvent.click(screen.getByText(EXPLAIN.open));
  const details = document.querySelector("details") as HTMLDetailsElement;
  // jsdom does not toggle <details> from a click on the summary; mirror what the browser does.
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

function body(): string {
  return document.querySelector(".guided-explain-body")?.textContent ?? "";
}

describe("ExplainPanel, before anything is connected", () => {
  it("asks which providers are offered on mount and shows the checking line while the probe is out", () => {
    const { connect } = renderPanel({ availability: null });
    expect(connect.ensureOffered).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".guided-explain-body")).toBeNull();
    open();
    const line = document.querySelector(".guided-explain-body [role='status']");
    expect(line?.textContent).toBe(EXPLAIN.checking);
    expect(line?.className).toBe("guided-meta");
  });

  it.each([
    ["not_connected", "chatgpt"],
    ["plan_not_eligible", "chatgpt"],
    ["not_offered", "claude_plan"],
    ["device_not_eligible", "apple"],
  ] as const)("opens to the not-connected body on %s (%s) with Connect my AI and Not now", (availability, provider) => {
    const { connect, value } = renderPanel({ availability, provider });
    open();
    const block = document.querySelector(".guided-explain-connect");
    expect(block?.querySelector("p")?.textContent).toBe(EXPLAIN.notConnected);
    expect(block?.textContent).not.toContain("·");
    expect(value.scan.explain).not.toHaveBeenCalled();
    const connectButton = screen.getByRole("button", { name: EXPLAIN.connect });
    expect(connectButton.className).toBe("guided-text-button");
    fireEvent.click(connectButton);
    expect(connect.open).toHaveBeenCalledWith({ name: "guided" }, { explainRuleId: RULE });
    const notNow = screen.getByRole("button", { name: EXPLAIN.notNow });
    expect(notNow.className).toBe("link-button");
    fireEvent.click(notNow);
    expect(connect.notNow).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".guided-explain-body")).toBeNull();
  });

  it("names Apple Intelligence when this Mac can run it, waits for the offered rows, and says not offered when nothing can be connected", () => {
    renderPanel({ availability: "not_connected", connect: { offered: { chatgpt: true, claude_plan: false, apple: true } } });
    open();
    expect(document.querySelector(".guided-explain-connect p")?.textContent).toBe(EXPLAIN.notConnectedApple);
    cleanup();
    // The offered rows are not known yet: the sentence without its buttons.
    renderPanel({ availability: "not_connected", connect: { offered: null, connectable: false } });
    open();
    expect(document.querySelector(".guided-explain-connect p")?.textContent).toBe(EXPLAIN.notConnected);
    expect(document.querySelectorAll(".guided-explain-body button").length).toBe(0);
    cleanup();
    // A build that offers neither ChatGPT nor Claude: the honest line, no pitch and no button.
    for (const provider of ["chatgpt", "claude_plan"] as const) {
      renderPanel({ availability: "not_offered", provider, connect: { offered: { chatgpt: false, claude_plan: false, apple: false }, connectable: false } });
      open();
      expect(document.querySelector(".guided-explain-connect")).toBeNull();
      expect(body()).toBe(EXPLAIN.notOffered[provider]);
      expect(body()).not.toContain("ChatGPT or Claude");
      expect(document.querySelectorAll(".guided-explain-body button").length).toBe(0);
      cleanup();
    }
  });

  it("renders the v0.2 line for the Apple Intelligence states instead of the pitch, with its one button", () => {
    const { value } = renderPanel({ availability: "apple_intelligence_not_enabled", provider: "apple", connect: { offered: { chatgpt: true, claude_plan: true, apple: true } } });
    open();
    expect(document.querySelector(".guided-explain-connect")).toBeNull();
    expect(body()).toContain(AI_UNAVAILABLE_COPY.apple_intelligence_not_enabled);
    expect(body()).not.toContain("ChatGPT");
    expect(screen.queryByRole("button", { name: EXPLAIN.connect })).toBeNull();
    const settings = screen.getByRole("button", { name: EXPLAIN.openAppleSettings });
    expect(settings.className).toBe("guided-text-button");
    fireEvent.click(settings);
    expect(value.adapters.openSettingsPane).toHaveBeenCalledWith("apple_intelligence");
    expect(value.ai.reprobe).toHaveBeenCalledWith(REPROBE_SETTINGS_MS);
    cleanup();
    renderPanel({ availability: "model_not_ready", provider: "apple" });
    open();
    expect(body()).toBe(AI_UNAVAILABLE_COPY.model_not_ready);
    expect(document.querySelectorAll(".guided-explain-body button").length).toBe(0);
    cleanup();
    const helper = renderPanel({ availability: "helper_unavailable", provider: "apple" });
    open();
    expect(body()).toContain(AI_UNAVAILABLE_COPY.helper_unavailable);
    fireEvent.click(screen.getByRole("button", { name: EXPLAIN.tryAgain }));
    expect(helper.value.ai.probe).toHaveBeenCalledWith(true);
    cleanup();
    // A Mac that cannot run it, with no other row to connect: the honest card, not a promise of ChatGPT or Claude.
    renderPanel({ availability: "device_not_eligible", provider: "apple", connect: { offered: { chatgpt: false, claude_plan: false, apple: false }, connectable: false } });
    open();
    expect(body()).toBe(AI_UNAVAILABLE_COPY.device_not_eligible);
    expect(document.querySelectorAll(".guided-explain-body button").length).toBe(0);
  });

  it("opens itself once when the controller remembers this step as the one that asked to connect", () => {
    const consumeResume = vi.fn((ruleId: string) => ruleId === RULE);
    const { value } = renderPanel({ connect: { consumeResume } });
    expect(consumeResume).toHaveBeenCalledWith(RULE);
    expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    expect(value.scan.explain).toHaveBeenCalledWith(RULE);
  });

  it("stays open under StrictMode's second effect run although the resume is consumed only once", () => {
    let pending: string | null = RULE;
    const consumeResume = vi.fn((ruleId: string) => {
      if (pending !== ruleId) return false;
      pending = null;
      return true;
    });
    const base = fakeContextValue({
      adapters: fakeAdapters(),
      license: { status: "none" },
      gate: { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false },
      scanState: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null },
      settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" } },
    });
    const value: AppContextValue = { ...base, ai: { ...base.ai, availability: "available", until: null, probe: vi.fn(async () => "available" as const) } };
    const connect = fakeConnectController({ offered: { chatgpt: true, claude_plan: true, apple: false }, connectable: true, consumeResume });
    render(createElement(StrictMode, null, createElement(StatefulProvider, { value, connect }, createElement(ExplainPanel, { ruleId: RULE }))));
    // The second effect run reads the kept id instead of consuming again.
    expect(consumeResume).toHaveBeenCalledTimes(1);
    expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    expect(value.scan.explain).toHaveBeenCalledWith(RULE);
  });

  it("shows the waiting line while the sign-in runs", () => {
    renderPanel({ availability: "connecting" });
    open();
    expect(document.querySelector(".guided-explain-body [role='status']")?.textContent).toBe(EXPLAIN.waiting);
    expect(document.querySelectorAll(".guided-explain-body button").length).toBe(0);
  });
});

describe("ExplainPanel, state lines", () => {
  it.each([
    ["chatgpt", "chatgpt"],
    ["claude_plan", "claude_plan"],
    ["claude", "claude_plan"],
  ] as const)("needs_sign_in on %s says who signed out and offers Sign in again", (provider, remote) => {
    const { connect, value } = renderPanel({ availability: "needs_sign_in", provider });
    open();
    expect(body()).toContain(EXPLAIN.signedOut[remote]);
    fireEvent.click(screen.getByRole("button", { name: EXPLAIN.signInAgain }));
    // The rule id travels with it so the disclosure reopens and streams after the sign-in.
    expect(connect.signInAgain).toHaveBeenCalledWith({ name: "guided" }, { explainRuleId: RULE });
    expect(value.scan.explain).not.toHaveBeenCalled();
  });

  it("limit_reached says it comes back on its own, or at the time the provider gave, with no button", () => {
    renderPanel({ availability: "limit_reached", provider: "claude_plan" });
    open();
    expect(body()).toBe(`${EXPLAIN.limit.claude_plan} ${EXPLAIN.limitBack}`);
    expect(document.querySelectorAll(".guided-explain-body button").length).toBe(0);
    cleanup();
    renderPanel({ availability: "limit_reached", provider: "chatgpt", until: "2026-10-16T18:00:00" });
    open();
    expect(body()).toBe(`${EXPLAIN.limit.chatgpt} ${EXPLAIN.limitBackAtPrefix}18:00.`);
  });

  it("provider_unavailable offers Try again, which probes fresh", () => {
    const { value } = renderPanel({ availability: "provider_unavailable" });
    open();
    expect(body()).toContain(EXPLAIN.didNotAnswer.chatgpt);
    fireEvent.click(screen.getByRole("button", { name: EXPLAIN.tryAgain }));
    expect(value.ai.probe).toHaveBeenCalledWith(true);
  });

  it("locked shows the full-version line, and Unlock opens the paywall step instead of drawing a field", () => {
    const onUnlock = vi.fn();
    const { value } = renderPanel({ locked: true, onUnlock });
    open();
    expect(body()).toContain(EXPLAIN.locked);
    expect(value.scan.explain).not.toHaveBeenCalled();
    const unlock = screen.getByRole("button", { name: EXPLAIN.unlock });
    expect(unlock.className).toBe("guided-text-button");
    fireEvent.click(unlock);
    expect(onUnlock).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".guided-licence")).toBeNull();
    expect(document.querySelector("input")).toBeNull();
    cleanup();
    // Without a way to the paywall the line stands alone.
    renderPanel({ locked: true });
    open();
    expect(body()).toBe(EXPLAIN.locked);
    expect(document.querySelectorAll(".guided-explain-body button").length).toBe(0);
  });

  it("probes once (cached) after a call fails because the provider's state changed", () => {
    const { value } = renderPanel({ explain: { kind: "failed", reason: "needs_sign_in", target: RULE, byRule: {}, order: null, priority: null } });
    open();
    expect(value.ai.probe).toHaveBeenCalledTimes(1);
    expect(value.ai.probe).toHaveBeenCalledWith();
    expect(body()).toContain(EXPLAINER_FAILURE_LABELS.needs_sign_in);
    cleanup();
    const second = renderPanel({ explain: { kind: "failed", reason: "rejected_output", target: RULE, byRule: {}, order: null, priority: null } });
    open();
    expect(second.value.ai.probe).not.toHaveBeenCalled();
    expect(body()).toContain(EXPLAINER_FAILURE_LABELS.rejected_output);
  });

  it("probes once even though every probe answer rebuilds the controller object", async () => {
    // In App the probe sets state and the ai object is new on each render; the effect must not chase it.
    const explain: ExplainState = { kind: "failed", reason: "limit_reached", target: RULE, byRule: {}, order: null, priority: null };
    const base = fakeContextValue({
      adapters: fakeAdapters(),
      license: { status: "none" },
      gate: { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false },
      scanState: { kind: "ready", report: REPORT, state: DEV_MACHINE, explain, lastRecheck: null, fixing: null, watching: null },
      settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" } },
    });
    const probe = vi.fn(async (_fresh?: boolean) => "limit_reached" as const);
    function Host() {
      const [, setRound] = useState(0);
      const ai: AppContextValue["ai"] = {
        availability: "limit_reached",
        until: null,
        probe: async (fresh?: boolean) => {
          const state = await probe(fresh);
          setRound((r) => r + 1);
          return state;
        },
        reprobe: () => () => undefined,
        report: () => undefined,
      };
      return createElement(StatefulProvider, { value: { ...base, ai }, connect: fakeConnectController({ offered: { chatgpt: true, claude_plan: true, apple: false }, connectable: true }) }, createElement(ExplainPanel, { ruleId: RULE }));
    }
    render(createElement(Host));
    open();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("ExplainPanel, explaining", () => {
  it("streams the text with Stop while running, no badge yet", () => {
    const { value } = renderPanel({ explain: { kind: "running", target: RULE, partial: { whyItMattersForYou: "Anyone on" }, answerPartial: null, from: { byRule: {}, order: null, priority: null } } });
    open();
    expect(value.scan.explain).toHaveBeenCalledWith(RULE);
    expect(body()).toContain("Anyone on");
    expect(screen.getByRole("button", { name: EXPLAIN.stop }).className).toBe("link-button");
    expect(document.querySelector(".guided-explain-badge")).toBeNull();
  });

  it.each(["apple", "chatgpt", "claude_plan", "claude", "ollama"] as const)("shows the ready text with the %s badge", (provider) => {
    renderPanel({ provider, explain: { kind: "ready", byRule: { [RULE]: EXPLANATION }, order: null, priority: null } });
    open();
    expect(body()).toContain(EXPLANATION.whyItMattersForYou);
    const badge = document.querySelector(".guided-explain-badge");
    expect(badge?.textContent).toBe(EXPLAIN.badge[provider]);
    expect(badge?.className).toBe("guided-meta guided-explain-badge");
    expect(badge?.textContent).toContain("Not verified.");
  });

  it("keeps the others list for the batch panel and switches the target", () => {
    const { value } = renderPanel({ others: ["TL-MAC-002" as typeof RULE] });
    open();
    const other = document.querySelector(".guided-explain-others button") as HTMLButtonElement;
    expect(other.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(other);
    expect(value.scan.explain).toHaveBeenLastCalledWith("TL-MAC-002");
  });
});
