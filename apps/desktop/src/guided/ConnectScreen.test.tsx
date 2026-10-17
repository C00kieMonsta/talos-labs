import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { AiConnectController, ConnectOffered, ConnectStage } from "../scan/ai-connect";
import { StatefulProvider, fakeAdapters, fakeConnectController, fakeContextValue } from "../app/testing";
import { ConnectScreen, connectRows } from "./ConnectScreen";
import { CONNECT, CONNECTING, CONNECT_FAILED } from "./copy";

afterEach(cleanup);

const gate = { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: true };
const ALL: ConnectOffered = { chatgpt: true, claude_plan: true, apple: true };

function renderConnect(overrides: Partial<AiConnectController> = {}) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate, scanState: { kind: "idle", last: null } });
  const connect = fakeConnectController({ offered: ALL, connectable: true, ...overrides });
  const view = render(createElement(StatefulProvider, { value, connect }, createElement(ConnectScreen)));
  return { connect, ...view };
}

function primaries(): string[] {
  return Array.from(document.querySelectorAll(".button-primary")).map((b) => b.textContent ?? "");
}

function links(): string[] {
  return Array.from(document.querySelectorAll(".guided-link")).map((b) => b.textContent ?? "");
}

describe("ConnectScreen, choosing", () => {
  it("asks the port once on mount and shows the loading line with no primary and no rows while offered is unknown", () => {
    const { connect } = renderConnect({ offered: null, connectable: false });
    expect(connect.ensureOffered).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1, name: CONNECT.title })).toBeTruthy();
    const status = document.querySelector(".guided-connect-status");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toBe(CONNECT.loading);
    expect(status?.querySelector("svg.spin")).not.toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(primaries()).toEqual([]);
    expect(links()).toEqual([CONNECT.notNow]);
  });

  it("renders a radiogroup labelled by the headline with native radios in the order ChatGPT, Claude, On this Mac and the first row selected", () => {
    renderConnect();
    expect(document.querySelector("[role='progressbar']")).toBeNull();
    const group = screen.getByRole("radiogroup", { name: CONNECT.title });
    expect(group.className).toBe("guided-choice");
    const radios = Array.from(group.querySelectorAll("input[type='radio'][name='ai-provider']")) as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(["chatgpt", "claude_plan", "apple"]);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
    const rows = Array.from(group.querySelectorAll("label.guided-choice-row"));
    expect(rows.map((row) => row.querySelector(".guided-choice-text")?.textContent)).toEqual([CONNECT.rows.chatgpt, CONNECT.rows.claude_plan, CONNECT.rows.apple]);
    expect(rows.map((row) => row.querySelector(".guided-choice-plan")?.textContent)).toEqual([CONNECT.plans.chatgpt, CONNECT.plans.claude_plan, CONNECT.plans.apple]);
    for (const row of rows) expect(row.querySelector("svg.guided-choice-icon")?.getAttribute("width")).toBe("20");
    expect(document.body.textContent).not.toContain("·");
    expect(primaries()).toEqual([CONNECT.primary.chatgpt]);
    expect(links()).toEqual([CONNECT.notNow]);
  });

  it("moves the primary's label with the selection and starts the chosen provider or uses this Mac", () => {
    const { connect } = renderConnect();
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(CONNECT.rows.claude_plan) }));
    expect(primaries()).toEqual([CONNECT.primary.claude_plan]);
    fireEvent.click(screen.getByRole("button", { name: CONNECT.primary.claude_plan }));
    expect(connect.start).toHaveBeenCalledWith("claude_plan");
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(CONNECT.rows.apple) }));
    expect(primaries()).toEqual([CONNECT.primary.apple]);
    fireEvent.click(screen.getByRole("button", { name: CONNECT.primary.apple }));
    expect(connect.useThisMac).toHaveBeenCalledTimes(1);
    expect(connect.start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: CONNECT.notNow }));
    expect(connect.notNow).toHaveBeenCalledTimes(1);
  });

  it("disables a row this build cannot offer, reads Not available yet in place of its plan, and defaults to the next row", () => {
    renderConnect({ offered: { chatgpt: false, claude_plan: true, apple: true } });
    const row = screen.getByRole("radio", { name: new RegExp(CONNECT.rows.chatgpt) }) as HTMLInputElement;
    expect(row.disabled).toBe(true);
    expect(row.checked).toBe(false);
    const label = row.closest("label");
    expect(label?.getAttribute("aria-disabled")).toBe("true");
    expect(label?.querySelector(".guided-choice-plan")?.textContent).toBe(CONNECT.notAvailable);
    expect(label?.textContent).not.toContain(CONNECT.plans.chatgpt);
    expect((screen.getByRole("radio", { name: new RegExp(CONNECT.rows.claude_plan) }) as HTMLInputElement).checked).toBe(true);
    expect(primaries()).toEqual([CONNECT.primary.claude_plan]);
  });

  it("hides On this Mac when the Mac cannot run it, and shows no primary when nothing can be connected", () => {
    renderConnect({ offered: { chatgpt: true, claude_plan: true, apple: false } });
    expect(screen.queryByRole("radio", { name: new RegExp(CONNECT.rows.apple) })).toBeNull();
    expect(screen.getAllByRole("radio").length).toBe(2);
    cleanup();
    renderConnect({ offered: { chatgpt: false, claude_plan: false, apple: false }, connectable: false });
    expect(screen.getAllByRole("radio").every((r) => (r as HTMLInputElement).disabled)).toBe(true);
    expect(primaries()).toEqual([]);
    expect(links()).toEqual([CONNECT.notNow]);
  });

  it("lists the rows from the offered flags", () => {
    expect(connectRows(ALL)).toEqual([
      { key: "chatgpt", enabled: true },
      { key: "claude_plan", enabled: true },
      { key: "apple", enabled: true },
    ]);
    expect(connectRows({ chatgpt: false, claude_plan: true, apple: false })).toEqual([
      { key: "chatgpt", enabled: false },
      { key: "claude_plan", enabled: true },
    ]);
  });
});

describe("ConnectScreen, connecting", () => {
  it("shows the fetching screen for Claude as headline, sentence and the spinner status only: no primary, no Cancel (DESIGN-AI section 4)", () => {
    renderConnect({ stage: { kind: "fetching", provider: "claude_plan" } });
    expect(screen.getByRole("heading", { level: 1, name: CONNECTING.fetchTitle })).toBeTruthy();
    expect(screen.getByText(CONNECTING.fetchBody)).toBeTruthy();
    const status = document.querySelector(".guided-connect-status");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toBe(CONNECTING.fetchStatus);
    expect(primaries()).toEqual([]);
    expect(links()).toEqual([]);
    expect(document.querySelectorAll("button").length).toBe(0);
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps the choose screen while start() has not answered, with the chosen row selected and every control disabled", () => {
    const { connect } = renderConnect({ stage: { kind: "starting", provider: "claude_plan" } });
    expect(screen.getByRole("heading", { level: 1, name: CONNECT.title })).toBeTruthy();
    const radios = Array.from(document.querySelectorAll("input[type='radio'][name='ai-provider']")) as HTMLInputElement[];
    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
    expect(radios.every((r) => r.disabled)).toBe(true);
    const status = document.querySelector(".guided-connect-status");
    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.textContent).toBe(CONNECT.loading);
    expect(primaries()).toEqual([CONNECT.primary.claude_plan]);
    const primary = document.querySelector<HTMLButtonElement>(".button-primary");
    expect(primary?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".guided-link")?.disabled).toBe(true);
    fireEvent.click(primary as HTMLButtonElement);
    expect(connect.start).not.toHaveBeenCalled();
  });

  it.each(["chatgpt", "claude_plan"] as const)("shows the waiting screen for %s with Cancel as the only control", (provider) => {
    const { connect } = renderConnect({ stage: { kind: "waiting", provider } });
    expect(screen.getByRole("heading", { level: 1, name: CONNECTING.opened[provider] })).toBeTruthy();
    expect(screen.getByText(CONNECTING.body)).toBeTruthy();
    expect(document.querySelector(".guided-connect-status[role='status']")?.textContent).toBe(CONNECTING.status);
    expect(primaries()).toEqual([]);
    expect(links()).toEqual([CONNECT.cancel]);
    expect(document.querySelectorAll("button").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: CONNECT.cancel }));
    expect(connect.cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["chatgpt", "claude_plan", "apple"] as const)("shows the done tick for %s with no controls", (provider) => {
    renderConnect({ stage: { kind: "done", provider } });
    expect(screen.getByRole("heading", { level: 1, name: CONNECT.done[provider] })).toBeTruthy();
    expect(document.querySelector(".guided-tick")).not.toBeNull();
    expect(document.querySelector("[data-guided-done='true']")).not.toBeNull();
    expect(Array.from(document.querySelectorAll("[role='status']")).map((n) => n.textContent)).toContain(CONNECT.done[provider]);
    expect(document.querySelectorAll("button").length).toBe(0);
  });
});

describe("ConnectScreen, failed", () => {
  const cases: { stage: ConnectStage; title: string; body: string; primary: string }[] = [
    { stage: { kind: "failed", provider: "chatgpt", outcome: "closed" }, title: CONNECT_FAILED.closed.title, body: CONNECT_FAILED.closed.body, primary: CONNECT.tryAgain },
    { stage: { kind: "failed", provider: "chatgpt", outcome: "plan_not_eligible" }, title: CONNECT_FAILED.plan_not_eligible.title, body: CONNECT_FAILED.plan_not_eligible.body.chatgpt, primary: CONNECT.chooseAnother },
    { stage: { kind: "failed", provider: "claude_plan", outcome: "plan_not_eligible" }, title: CONNECT_FAILED.plan_not_eligible.title, body: CONNECT_FAILED.plan_not_eligible.body.claude_plan, primary: CONNECT.chooseAnother },
    { stage: { kind: "failed", provider: "chatgpt", outcome: "provider_unavailable" }, title: CONNECT_FAILED.provider_unavailable.title.chatgpt, body: CONNECT_FAILED.provider_unavailable.body, primary: CONNECT.tryAgain },
    { stage: { kind: "failed", provider: "claude_plan", outcome: "provider_unavailable" }, title: CONNECT_FAILED.provider_unavailable.title.claude_plan, body: CONNECT_FAILED.provider_unavailable.body, primary: CONNECT.tryAgain },
    { stage: { kind: "failed", provider: "chatgpt", outcome: "timeout" }, title: CONNECT_FAILED.timeout.title, body: CONNECT_FAILED.timeout.body, primary: CONNECT.tryAgain },
    { stage: { kind: "failed", provider: "claude_plan", outcome: "fetch_failed" }, title: CONNECTING.fetchFailedTitle, body: CONNECTING.fetchFailedBody, primary: CONNECT.tryAgain },
  ];

  it.each(cases)("renders $stage.outcome for $stage.provider with one primary and Not now", ({ stage, title, body, primary }) => {
    const { connect } = renderConnect({ stage });
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    expect(primaries()).toEqual([primary]);
    expect(links()).toEqual([CONNECT.notNow]);
    expect(document.querySelector(".guided-tick")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: primary }));
    if (primary === CONNECT.chooseAnother) {
      expect(connect.chooseAnother).toHaveBeenCalledTimes(1);
      expect(connect.tryAgain).not.toHaveBeenCalled();
    } else {
      expect(connect.tryAgain).toHaveBeenCalledTimes(1);
      expect(connect.chooseAnother).not.toHaveBeenCalled();
    }
    fireEvent.click(screen.getByRole("button", { name: CONNECT.notNow }));
    expect(connect.notNow).toHaveBeenCalledTimes(1);
  });
});
