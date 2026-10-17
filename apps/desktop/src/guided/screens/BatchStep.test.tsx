import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import type { GuidedStep } from "@talos/core";
import { DEV_MACHINE } from "@talos/core";
import { AppContext } from "../../app/context";
import { fakeAdapters, fakeBatchPlan, fakeContextValue, fakeFinding, fakeReport } from "../../app/testing";
import type { ScanState } from "../../scan/machine";
import { STATUS } from "../copy";
import type { GuidedController, StepState } from "../state";
import { BatchStep } from "./BatchStep";
import { INERT_CHAT_BRIDGE } from "../testing";

afterEach(cleanup);

const STEP: Extract<GuidedStep, { kind: "batch" }> = { id: "batch", kind: "batch", ruleIds: ["TL-MAC-002", "TL-MAC-008", "TL-MAC-011"] };
const GATE = { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false };

function controller(state: StepState): GuidedController {
  return {
    phase: { kind: "step", plan: { reportId: "r", freeFixes: [], steps: [STEP], leftAlone: [], worthALook: [], technical: [], later: [], locked: [], accepted: [], unreadable: 0 }, index: 0, state, notice: null },
    progress: { done: 0, of: 1 },
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
    chat: INERT_CHAT_BRIDGE,
    keepAsking: vi.fn(),
    accept: vi.fn(),
  };
}

describe("BatchStep activity rows", () => {
  it("keeps the password sentence as the headline and draws the admin row while macOS asks", () => {
    const plan = fakeBatchPlan({
      items: STEP.ruleIds.map((ruleId) => ({ ruleId, lines: [{ text: "a", privilege: "admin" as const }], recheck: ["firewall" as const], previous: null })),
      needsPassword: true,
    });
    const fixing = { kind: "batch" as const, plan, phase: "waiting_for_password" as const, step: 1, of: 3, item: null, error: null, outcome: null, byRule: {} };
    const report = fakeReport(STEP.ruleIds.map((ruleId) => fakeFinding({ ruleId, status: "fail" })));
    const scanState: ScanState = { kind: "ready", report, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing, watching: null };
    const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: GATE, scanState });
    const state: StepState = { kind: "working", label: STATUS.password };
    const { container } = render(createElement(AppContext.Provider, { value }, createElement(BatchStep, { step: STEP, state, controller: controller(state), notice: null })));
    const rows = Array.from(container.querySelectorAll("li.chat-activity-row")).map((r) => r.textContent);
    expect(rows).toEqual(["Getting readydone", "Fixing 3 thingsyour password"]);
    expect(container.querySelector(".guided-status")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe(STATUS.password.slice(0, STATUS.password.indexOf(". ") + 1));
    expect(container.querySelector("ul.guided-list")).toBeNull();
  });
});
