import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { createRequire } from "node:module";
import { AppContext } from "../app/context";
import { fakeAdapters, fakeContextValue } from "../app/testing";
import { StepFrame, markInteracted } from "./StepFrame";
import { GuidedList } from "./GuidedList";
import { EXPLAIN } from "./copy";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

function renderStep(props: Parameters<typeof StepFrame>[0], children?: React.ReactNode) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => true }, scanState: { kind: "idle", last: null } });
  return render(createElement(AppContext.Provider, { value }, createElement(StepFrame, props, children)));
}

describe("StepFrame accessibility", () => {
  it("has one primary button, one h1, status roles and no nested interactive element", async () => {
    markInteracted();
    const { container } = renderStep(
      { progress: { done: 1, of: 5 }, title: "The firewall is off", body: createElement("p", null, "Why it matters."), primary: { label: "Turn it on", onClick: vi.fn() }, link: { label: "Do this later", onClick: vi.fn() }, status: "Getting ready" },
      createElement(GuidedList, { rows: [{ key: "a", text: "The firewall is off", icon: "bullet" }] }),
    );
    const result = await axe.run(container, { runOnly: ["nested-interactive", "button-name", "heading-order", "aria-valid-attr-value", "aria-progressbar-name", "list", "listitem"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    expect(container.querySelectorAll(".button-primary").length).toBe(1);
    expect(container.querySelectorAll("h1").length).toBe(1);
    expect(container.querySelector("[role='progressbar']")?.getAttribute("aria-valuetext")).toBe("Step 1 of 5");
    expect(container.querySelector(".guided-status")?.getAttribute("role")).toBe("status");
    expect(container.querySelector(".guided-status .scan-dot")).not.toBeNull();
    expect(container.querySelector(".guided-status svg")).toBeNull();
    expect(container.querySelector("[role='progressbar'] > div")?.getAttribute("style")).toContain("width: 20%");
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("renders a done line with the tick announced through role=status and no primary", () => {
    const { container } = renderStep({ progress: { done: 2, of: 5 }, title: "Done. The firewall is on.", done: true, link: { label: "Next", onClick: vi.fn() } });
    expect(container.querySelectorAll(".button-primary").length).toBe(0);
    expect(container.querySelector(".guided-tick")).not.toBeNull();
    const status = Array.from(container.querySelectorAll("[role='status']")).map((n) => n.textContent);
    expect(status).toContain("Done. The firewall is on.");
    expect(container.querySelector("main")).toBeNull();
  });

  it("keeps the done semantics without the mark when mark is false", () => {
    const { container } = renderStep({ progress: { done: 2, of: 5 }, title: "Done. 3 things fixed.", done: true, mark: false, link: { label: "Next", onClick: vi.fn() } });
    expect(container.querySelector(".guided-tick")).toBeNull();
    expect(container.querySelector("[data-guided-done='true']")).not.toBeNull();
    const status = Array.from(container.querySelectorAll("[role='status']")).map((n) => n.textContent);
    expect(status).toContain("Done. 3 things fixed.");
  });

  it("shows the Explain disclosure for a provider that is not connected, and hides it only when AI is off", () => {
    const base = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => true }, scanState: { kind: "idle", last: null } });
    const probe = vi.fn(async () => "not_connected" as const);
    const value = { ...base, settings: { ...base.settings, explainer: { ...base.settings.explainer, provider: "chatgpt" as const } }, ai: { ...base.ai, availability: "not_connected" as const, probe } };
    const { container } = render(createElement(AppContext.Provider, { value }, createElement(StepFrame, { progress: { done: 1, of: 5 }, title: "The firewall is off", explainRuleId: "TL-MAC-001" })));
    expect(container.querySelector(".guided-explain summary")?.textContent).toBe(EXPLAIN.open);
    expect(probe).not.toHaveBeenCalled();
    cleanup();
    const off = { ...value, settings: { ...value.settings, explainer: { ...value.settings.explainer, aiEnabled: false } } };
    const second = render(createElement(AppContext.Provider, { value: off }, createElement(StepFrame, { progress: { done: 1, of: 5 }, title: "The firewall is off", explainRuleId: "TL-MAC-001" })));
    expect(second.container.querySelector(".guided-explain")).toBeNull();
    cleanup();
    const unknown = { ...value, ai: { ...value.ai, availability: null } };
    render(createElement(AppContext.Provider, { value: unknown }, createElement(StepFrame, { progress: { done: 1, of: 5 }, title: "The firewall is off", explainRuleId: "TL-MAC-001" })));
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
