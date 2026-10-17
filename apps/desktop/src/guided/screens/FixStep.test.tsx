import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import type { GuidedStep } from "@talos/core";
import { DEV_MACHINE } from "@talos/core";
import { AppContext } from "../../app/context";
import { fakeAdapters, fakeContextValue, fakeFinding, fakePlan, fakeReport } from "../../app/testing";
import type { ScanState } from "../../scan/machine";
import { STATUS } from "../copy";
import type { GuidedController, StepState } from "../state";
import { FixStep } from "./FixStep";

afterEach(cleanup);

const STEP: Extract<GuidedStep, { kind: "fix" }> = { id: "fix:TL-MAC-002", kind: "fix", ruleId: "TL-MAC-002", choice: { kind: "none" }, passphrase: false };
const GATE = { licensed: false, freeFixes: ["TL-MAC-002" as const], has: () => false, fixLocked: () => false, explainLocked: () => false, watchLocked: true };

function controller(state: StepState): GuidedController {
  return {
    phase: { kind: "step", plan: { reportId: "r", freeFixes: ["TL-MAC-002"], steps: [STEP], leftAlone: [], worthALook: [], technical: [], later: [], locked: [], accepted: [], unreadable: 0 }, index: 0, state, notice: null },
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
    keepAsking: vi.fn(),
    accept: vi.fn(),
  };
}

function renderWorking(fixing: Extract<ScanState, { kind: "ready" }>["fixing"], label: string) {
  const report = fakeReport([fakeFinding({ ruleId: "TL-MAC-002", status: "fail" })]);
  const scanState: ScanState = { kind: "ready", report, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing, watching: null };
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: GATE, scanState });
  const state: StepState = { kind: "working", label };
  return render(createElement(AppContext.Provider, { value }, createElement(FixStep, { step: STEP, state, controller: controller(state), notice: null })));
}

describe("FixStep activity rows", () => {
  it("draws the rows for a single admin fix while macOS asks for the password", () => {
    const fixing = { kind: "single" as const, plan: fakePlan({ ruleId: "TL-MAC-002", needsPassword: true }), phase: "waiting_for_password" as const, step: 1, of: 1, error: null, result: null };
    const { container } = renderWorking(fixing, STATUS.password);
    const rows = Array.from(container.querySelectorAll("li.chat-activity-row")).map((r) => r.textContent);
    expect(rows).toEqual(["Getting readydone", "Turning it onyour password"]);
    expect(container.querySelector(".guided-status")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toBe("The firewall is off");
    expect(container.querySelectorAll(".button-primary").length).toBe(0);
  });

  it("falls back to the status line on Check again, when nothing is fixing", () => {
    const { container } = renderWorking(null, STATUS.checking);
    expect(container.querySelector("ul.guided-activity")).toBeNull();
    expect(container.querySelector(".guided-status")?.textContent).toBe(STATUS.checking);
  });
});
