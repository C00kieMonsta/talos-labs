import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { createRequire } from "node:module";
import type { GuidedStep } from "@talos/core";
import { AppContext } from "../../app/context";
import { fakeAdapters, fakeContextValue } from "../../app/testing";
import { ACCEPT } from "../copy";
import { guidedFor } from "../plan";
import type { GuidedController, StepState } from "../state";
import { BatchStep } from "./BatchStep";
import { FixStep } from "./FixStep";
import { ShowStep } from "./ShowStep";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

const FIX: Extract<GuidedStep, { kind: "fix" }> = { id: "fix:TL-MAC-002", kind: "fix", ruleId: "TL-MAC-002", choice: { kind: "none" }, passphrase: false };
const SHOW: Extract<GuidedStep, { kind: "show" }> = { id: "show:TL-MAC-001", kind: "show", ruleId: "TL-MAC-001", pane: "filevault", watch: ["diskEncryption"], watchEvery: 3000, restart: false, question: null };
const BATCH: Extract<GuidedStep, { kind: "batch" }> = { id: "batch", kind: "batch", ruleIds: ["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"] };
const GATE = { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false };

function controller(step: GuidedStep, state: StepState): GuidedController {
  return {
    phase: { kind: "step", plan: { reportId: "r", freeFixes: [], steps: [step], leftAlone: [], worthALook: [], technical: [], later: [], locked: [], accepted: [], unreadable: 0 }, index: 0, state, notice: null },
    progress: { done: 2, of: 5 },
    start: vi.fn(),
    carryOn: vi.fn(),
    primary: vi.fn(),
    later: vi.fn(),
    next: vi.fn(),
    answer: vi.fn(),
    toggleList: vi.fn(),
    enterLicence: vi.fn(async () => undefined),
    doNext: vi.fn(),
    goToPaywall: vi.fn(),
    keepAsking: vi.fn(),
    accept: vi.fn(),
  };
}

function mount(step: GuidedStep, state: StepState) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: GATE, scanState: { kind: "idle", report: null, last: null } });
  const c = controller(step, state);
  const screenFor = step.kind === "fix" ? FixStep : step.kind === "show" ? ShowStep : BatchStep;
  const { container } = render(createElement(AppContext.Provider, { value }, createElement(screenFor as typeof FixStep, { step: step as never, state, controller: c, notice: null })));
  return { container, c };
}

describe("AcceptScreen", () => {
  it.each([
    { name: "fix", step: FIX, ruleIds: ["TL-MAC-002" as const] },
    { name: "show", step: SHOW, ruleIds: ["TL-MAC-001" as const] },
  ])("asks about one rule on a $name step with the singular strings, one primary, one link and the Explain disclosure", async ({ step, ruleIds }) => {
    const { container, c } = mount(step, { kind: "ask_accept", ruleIds });
    expect(screen.getByRole("heading", { level: 1, name: ACCEPT.title })).toBeTruthy();
    expect(screen.getByText(ACCEPT.body)).toBeTruthy();
    expect(container.querySelectorAll(".button-primary").length).toBe(1);
    expect(container.querySelectorAll(".guided-link").length).toBe(1);
    expect(container.querySelector(".guided-step")?.className).toContain("guided-ask-accept");
    expect(container.querySelector(".guided-list")).toBeNull();
    expect(container.querySelector("details")).not.toBeNull();
    // stepProgress reads "3 of 5" on the step at index 2, like every step.
    expect(container.querySelector(".guided-progress")?.textContent).toContain("3 of 5");
    screen.getByRole("button", { name: ACCEPT.primary }).click();
    expect(c.keepAsking).toHaveBeenCalledTimes(1);
    screen.getByRole("button", { name: ACCEPT.link }).click();
    expect(c.accept).toHaveBeenCalledTimes(1);
    expect(c.later).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/accept/i);
    const result = await axe.run(container, { runOnly: ["nested-interactive", "button-name", "heading-order", "aria-valid-attr-value", "aria-progressbar-name", "list", "listitem"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it("asks about the rules whose count reached the limit on a batch, with the plural strings, their headlines and no disclosure", async () => {
    const { container, c } = mount(BATCH, { kind: "ask_accept", ruleIds: ["TL-MAC-002", "TL-MAC-003"] });
    expect(screen.getByRole("heading", { level: 1, name: ACCEPT.titleMany })).toBeTruthy();
    expect(screen.getByText(ACCEPT.bodyMany)).toBeTruthy();
    expect(container.querySelectorAll(".button-primary").length).toBe(1);
    expect(container.querySelectorAll(".guided-link").length).toBe(1);
    const rows = Array.from(container.querySelectorAll(".guided-list .guided-row-text")).map((n) => n.textContent);
    expect(rows).toEqual([guidedFor("TL-MAC-002").headline, guidedFor("TL-MAC-003").headline]);
    expect(container.querySelector("details")).toBeNull();
    screen.getByRole("button", { name: ACCEPT.linkMany }).click();
    expect(c.accept).toHaveBeenCalledTimes(1);
    const result = await axe.run(container, { runOnly: ["nested-interactive", "button-name", "heading-order", "aria-valid-attr-value", "aria-progressbar-name", "list", "listitem"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
});
