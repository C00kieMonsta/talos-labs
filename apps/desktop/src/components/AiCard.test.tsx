import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRequire } from "node:module";
import type { AiAvailability, ExplainerFailure, LicenseState } from "@talos/core";
import { AI_ACTIONS, AI_BADGES, formatTime, providerLines } from "../app/labels";
import type { Gate } from "../app/gate";
import { StatefulProvider, fakeAdapters, fakeConnectController, fakeContextValue, fakeFinding, fakeReport } from "../app/testing";
import type { ExplainState } from "../scan/machine";
import { DEFAULT_SETTINGS } from "../settings";
import type { ExplainerProvider } from "../settings";
import { AI_LOCKED_COPY, AI_UNAVAILABLE_COPY, AiCard, aiCardState, aiUnavailableCopy, useAiCardFlow } from "./AiCard";
import type { AiCardState } from "./AiCard";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

/** Six o'clock in the evening, local time, so formatTime prints 18:00 wherever the test runs. */
const SIX_PM = new Date(2026, 9, 16, 18, 0, 0).toISOString();

const NONE: LicenseState = { status: "none" };
const findings = [
  fakeFinding({ ruleId: "TL-MAC-001", status: "fail", points: 20 }),
  fakeFinding({ ruleId: "TL-MAC-002", status: "fail", points: 8 }),
];
const report = fakeReport(findings);

/** An unlicensed gate whose only free explanation is TL-MAC-001. */
function freeGate(): Gate {
  return {
    licensed: false,
    freeFixes: ["TL-MAC-001"],
    has: () => false,
    fixLocked: (f) => f.ruleId !== "TL-MAC-001",
    explainLocked: (id) => id !== "TL-MAC-001",
  };
}

function handlers() {
  return {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRetry: vi.fn(),
    onOpenAiSettings: vi.fn(),
    onBuy: vi.fn(),
    onConnect: vi.fn(),
    onCancelConnect: vi.fn(),
    onSignInAgain: vi.fn(),
    onChooseAnother: vi.fn(),
  };
}

/** The locked state renders the licence field, which reads the app context. */
function bareContext() {
  return fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: freeGate(), scanState: { kind: "idle", report: null, last: null } });
}

function card(state: AiCardState, provider: ExplainerProvider = "chatgpt", kind: "finding" | "overview" | "ask" = "overview") {
  const h = handlers();
  const view = render(
    <StatefulProvider value={bareContext()}>
      <AiCard kind={kind} state={state} provider={provider} {...h} />
    </StatefulProvider>,
  );
  const head = () => view.container.querySelector(".ai-card-head p") as HTMLElement | null;
  const buttons = () => Array.from(view.container.querySelectorAll("button")).map((b) => b.textContent?.trim());
  return { ...view, h, head, buttons };
}

describe("AiCard provider states", () => {
  it("renders every ChatGPT state with its line and its one action", () => {
    const lines = providerLines("chatgpt");
    const rows: [AiCardState, string, string | null, keyof ReturnType<typeof handlers> | null][] = [
      [{ kind: "not_connected" }, lines.notConnected, AI_ACTIONS.connect, "onConnect"],
      [{ kind: "connecting" }, lines.connecting, AI_ACTIONS.cancel, "onCancelConnect"],
      [{ kind: "needs_sign_in" }, lines.needsSignIn, AI_ACTIONS.signInAgain, "onSignInAgain"],
      [{ kind: "limit_reached", until: null }, lines.limitReached, null, null],
      [{ kind: "plan_not_eligible" }, lines.planNotEligible, AI_ACTIONS.chooseAnother, "onChooseAnother"],
      [{ kind: "provider_unavailable" }, lines.providerUnavailable, AI_ACTIONS.tryAgain, "onRetry"],
      [{ kind: "not_offered" }, lines.notOffered, AI_ACTIONS.chooseAnother, "onChooseAnother"],
    ];
    for (const [state, text, action, handler] of rows) {
      const c = card(state);
      expect(c.container.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe(state.kind);
      expect(c.head()?.textContent).toBe(text);
      expect(c.buttons()).toEqual(action === null ? [] : [action]);
      if (action !== null && handler !== null) {
        fireEvent.click(screen.getByRole("button", { name: action }));
        expect(c.h[handler]).toHaveBeenCalledTimes(1);
      }
      cleanup();
    }
  });

  it("says what it explains in the not-connected line: the order on the Overview, this thing on a finding or Ask", () => {
    const lines = providerLines("chatgpt");
    expect(lines.notConnected).toBe("Get the order explained by the AI you already use.");
    expect(lines.notConnectedFinding).toBe("Get this explained by the AI you already use.");
    const o = card({ kind: "not_connected" }, "chatgpt", "overview");
    expect(o.head()?.textContent).toBe(lines.notConnected);
    cleanup();
    for (const kind of ["finding", "ask"] as const) {
      const c = card({ kind: "not_connected" }, "claude_plan", kind);
      expect(c.head()?.textContent).toBe(lines.notConnectedFinding);
      expect(c.buttons()).toEqual([AI_ACTIONS.connect]);
      cleanup();
    }
    expect(aiUnavailableCopy("chatgpt", "not_connected")).toBe(lines.notConnected);
    expect(aiUnavailableCopy("chatgpt", "not_connected", null, "finding")).toBe(lines.notConnectedFinding);
  });

  it("names Claude in the Claude lines and keeps the Apple lines for On this Mac", () => {
    const c = card({ kind: "needs_sign_in" }, "claude_plan");
    expect(c.head()?.textContent).toBe("Claude signed me out.");
    cleanup();
    const d = card({ kind: "plan_not_eligible" }, "claude_plan");
    expect(d.head()?.textContent).toBe("That Claude account's plan doesn't include this. Pro or Max is needed.");
    cleanup();
    const e = card({ kind: "device_not_eligible" }, "apple");
    expect(e.head()?.textContent).toBe(AI_UNAVAILABLE_COPY.device_not_eligible);
    expect(e.buttons()).toEqual([]);
    cleanup();
    const f = card({ kind: "apple_intelligence_not_enabled" }, "apple");
    fireEvent.click(screen.getByRole("button", { name: "Open Apple Intelligence settings" }));
    expect(f.h.onOpenAiSettings).toHaveBeenCalled();
    cleanup();
    const g = card({ kind: "helper_unavailable" }, "apple");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(g.h.onRetry).toHaveBeenCalled();
  });

  it("prints the time a limit comes back in its own span", () => {
    const c = card({ kind: "limit_reached", until: SIX_PM });
    expect(c.head()?.textContent).toBe(`Your ChatGPT allowance is used up for now. It comes back at ${formatTime(SIX_PM)}.`);
    expect(c.head()?.textContent).toContain("It comes back at 18:00.");
    expect(c.container.querySelector(".ai-card-until")?.textContent).toBe("It comes back at 18:00.");
    expect(c.buttons()).toEqual([]);
    expect(aiUnavailableCopy("chatgpt", "limit_reached", SIX_PM)).toContain("18:00");
    expect(aiUnavailableCopy("chatgpt", "limit_reached")).toBe("Your ChatGPT allowance is used up for now. It comes back on its own.");
  });

  it("marks the waiting line as a status with a spinning icon, and the probing line names the provider", () => {
    const c = card({ kind: "connecting" });
    expect(c.head()?.getAttribute("role")).toBe("status");
    expect(c.container.querySelector("svg.spin")).not.toBeNull();
    cleanup();
    const p = card({ kind: "probing" }, "claude_plan");
    expect(p.head()?.textContent).toBe("Checking whether Claude is connected");
    cleanup();
    const a = card({ kind: "probing" }, "apple");
    expect(a.head()?.textContent).toBe("Checking whether Apple Intelligence is available");
  });

  it("signs the ready foot with the provider's badge and keeps the lock with the licence field", () => {
    for (const provider of ["apple", "chatgpt", "claude_plan", "claude", "ollama"] as const) {
      const c = card({ kind: "ready" }, provider);
      expect(c.container.querySelector(".ai-card-foot")?.textContent).toBe(AI_BADGES[provider]);
      cleanup();
    }
    const l = card({ kind: "locked" });
    expect(l.head()?.textContent).toBe(AI_LOCKED_COPY);
    expect(screen.getByPlaceholderText("Paste your licence key")).toBeTruthy();
  });

  it("has a name on every button in every state", async () => {
    const states: AiCardState[] = [
      { kind: "probing" },
      { kind: "available_idle" },
      { kind: "streaming" },
      { kind: "ready" },
      { kind: "failed", reason: "timeout" },
      { kind: "device_not_eligible" },
      { kind: "apple_intelligence_not_enabled" },
      { kind: "model_not_ready" },
      { kind: "helper_unavailable" },
      { kind: "not_connected" },
      { kind: "connecting" },
      { kind: "needs_sign_in" },
      { kind: "limit_reached", until: SIX_PM },
      { kind: "plan_not_eligible" },
      { kind: "provider_unavailable" },
      { kind: "not_offered" },
      { kind: "locked" },
    ];
    for (const state of states) {
      const c = card(state);
      const result = await axe.run(c.container, { runOnly: ["button-name", "nested-interactive", "aria-allowed-role"] });
      expect(result.violations.map((v) => v.id), state.kind).toEqual([]);
      cleanup();
    }
  });
});

describe("aiCardState", () => {
  it("puts availability before the lock and carries until for a limit", () => {
    expect(aiCardState(null, null, true, "idle")).toEqual({ kind: "probing" });
    expect(aiCardState("not_connected", null, true, "idle")).toEqual({ kind: "not_connected" });
    expect(aiCardState("device_not_eligible", null, true, "idle")).toEqual({ kind: "device_not_eligible" });
    expect(aiCardState("limit_reached", SIX_PM, true, "idle")).toEqual({ kind: "limit_reached", until: SIX_PM });
    expect(aiCardState("available", null, true, "idle")).toEqual({ kind: "locked" });
    expect(aiCardState("available", null, false, "idle")).toEqual({ kind: "available_idle" });
    expect(aiCardState("available", null, false, "streaming")).toEqual({ kind: "streaming" });
    expect(aiCardState("available", null, false, "ready")).toEqual({ kind: "ready" });
    expect(aiCardState("off", null, false, "idle")).toEqual({ kind: "available_idle" });
  });

  it("shows a provider state change reported by a failed call, and a plain failure otherwise", () => {
    expect(aiCardState("available", null, false, { failed: "needs_sign_in" })).toEqual({ kind: "needs_sign_in" });
    expect(aiCardState("available", SIX_PM, false, { failed: "limit_reached" })).toEqual({ kind: "limit_reached", until: SIX_PM });
    expect(aiCardState("available", null, false, { failed: "provider_unavailable" })).toEqual({ kind: "provider_unavailable" });
    expect(aiCardState("available", null, false, { failed: "timeout" })).toEqual({ kind: "failed", reason: "timeout" });
  });
});

function Probe({ target }: { target: "prioritise" | "ask" | "TL-MAC-001" | "TL-MAC-002" }) {
  const flow = useAiCardFlow(target);
  return <AiCard kind={target === "prioritise" ? "overview" : target === "ask" ? "ask" : "finding"} state={flow.state} provider={flow.provider} {...flow.handlers} />;
}

function flowContext(input: { availability: AiAvailability | null; until?: string | null; explain?: ExplainState; provider?: ExplainerProvider; route?: "overview" | "settings" }) {
  const value = fakeContextValue({
    adapters: fakeAdapters(),
    license: NONE,
    gate: freeGate(),
    settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: input.provider ?? "chatgpt" } },
    scanState: { kind: "ready", report, state: { schemaVersion: 1, collectedAt: report.collectedAt, host: report.platform, sections: {} as never }, explain: input.explain ?? { kind: "off" }, lastRecheck: null, fixing: null, watching: null },
  });
  return {
    ...value,
    router: { ...value.router, route: { name: input.route ?? "overview" } },
    ai: { ...value.ai, availability: input.availability, until: input.until ?? null },
  };
}

describe("useAiCardFlow", () => {
  it("locks per rule for a finding and licence-wide for the order", () => {
    render(
      <StatefulProvider value={flowContext({ availability: "available" })}>
        <Probe target="TL-MAC-001" />
      </StatefulProvider>,
    );
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("available_idle");
    cleanup();
    render(
      <StatefulProvider value={flowContext({ availability: "available" })}>
        <Probe target="TL-MAC-002" />
      </StatefulProvider>,
    );
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("locked");
    cleanup();
    render(
      <StatefulProvider value={flowContext({ availability: "available" })}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("locked");
    cleanup();
    // Availability wins over the lock for the free rule and the locked one alike.
    render(
      <StatefulProvider value={flowContext({ availability: "not_connected" })}>
        <Probe target="TL-MAC-002" />
      </StatefulProvider>,
    );
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("not_connected");
  });

  it("opens the connect screen with the current route as the return route, and cancels or signs in again through the controller", () => {
    const connect = fakeConnectController();
    const { rerender } = render(
      <StatefulProvider value={flowContext({ availability: "not_connected", route: "settings" })} connect={connect}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.connect }));
    expect(connect.open).toHaveBeenCalledWith({ name: "settings" });
    rerender(
      <StatefulProvider value={flowContext({ availability: "connecting" })} connect={connect}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.cancel }));
    expect(connect.cancel).toHaveBeenCalledTimes(1);
    rerender(
      <StatefulProvider value={flowContext({ availability: "needs_sign_in" })} connect={connect}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.signInAgain }));
    expect(connect.signInAgain).toHaveBeenCalledWith({ name: "overview" });
    rerender(
      <StatefulProvider value={flowContext({ availability: "not_offered" })} connect={connect}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.chooseAnother }));
    expect(connect.open).toHaveBeenLastCalledWith({ name: "overview" });
  });

  it("re-probes fresh on Try again when the provider did not answer, and probes once after a failed call with a provider reason", () => {
    const value = flowContext({ availability: "provider_unavailable" });
    render(
      <StatefulProvider value={value}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.tryAgain }));
    expect(value.ai.probe).toHaveBeenCalledWith(true);
    expect(value.scan.prioritise).not.toHaveBeenCalled();
    cleanup();
    const failed: ExplainState = { kind: "failed", reason: "needs_sign_in", target: "prioritise", byRule: {}, order: null, priority: null };
    const after = flowContext({ availability: "available", explain: failed });
    const { rerender } = render(
      <StatefulProvider value={after}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("needs_sign_in");
    expect(after.ai.probe).toHaveBeenCalledTimes(1);
    expect(after.ai.probe).toHaveBeenCalledWith();
    rerender(
      <StatefulProvider value={after}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    expect(after.ai.probe).toHaveBeenCalledTimes(1);
    cleanup();
    const plain: ExplainState = { kind: "failed", reason: "timeout" as ExplainerFailure, target: "prioritise", byRule: {}, order: null, priority: null };
    const generic = flowContext({ availability: "available", explain: plain });
    render(
      <StatefulProvider value={generic}>
        <Probe target="prioritise" />
      </StatefulProvider>,
    );
    expect(generic.ai.probe).not.toHaveBeenCalled();
  });
});
