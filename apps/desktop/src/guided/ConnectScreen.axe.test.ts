import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { createRequire } from "node:module";
import type { AiConnectController } from "../scan/ai-connect";
import { StatefulProvider, fakeAdapters, fakeConnectController, fakeContextValue } from "../app/testing";
import { ConnectScreen } from "./ConnectScreen";
import { markInteracted } from "./StepFrame";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

const RULES = ["nested-interactive", "button-name", "heading-order", "label", "aria-allowed-attr", "aria-allowed-role", "aria-valid-attr-value", "aria-required-children", "list", "listitem"];

function renderConnect(overrides: Partial<AiConnectController> = {}) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => true }, scanState: { kind: "idle", last: null } });
  const connect = fakeConnectController({ offered: { chatgpt: false, claude_plan: true, apple: true }, connectable: true, ...overrides });
  return render(createElement(StatefulProvider, { value, connect }, createElement(ConnectScreen)));
}

describe("ConnectScreen accessibility", () => {
  it("has labelled radios in a named radiogroup, one h1, one primary and no nested interactive element; focus lands on the headline", async () => {
    markInteracted();
    const { container } = renderConnect();
    const result = await axe.run(container, { runOnly: RULES });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    expect(container.querySelectorAll("h1").length).toBe(1);
    expect(container.querySelectorAll(".button-primary").length).toBe(1);
    expect(container.querySelectorAll("[role='radiogroup']").length).toBe(1);
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("keeps the connecting and failed screens clean, with the spinner line as a status", async () => {
    for (const stage of [
      { kind: "starting", provider: "claude_plan" },
      { kind: "fetching", provider: "claude_plan" },
      { kind: "waiting", provider: "chatgpt" },
      { kind: "done", provider: "chatgpt" },
      { kind: "failed", provider: "claude_plan", outcome: "plan_not_eligible" },
    ] as const) {
      const { container } = renderConnect({ stage });
      const result = await axe.run(container, { runOnly: RULES });
      expect(result.violations.map((v) => v.id)).toEqual([]);
      expect(container.querySelectorAll("h1").length).toBe(1);
      if (stage.kind === "starting" || stage.kind === "fetching" || stage.kind === "waiting") expect(container.querySelector(".guided-connect-status")?.getAttribute("role")).toBe("status");
      if (stage.kind === "fetching") expect(container.querySelectorAll("button").length).toBe(0);
      cleanup();
    }
  });
});
