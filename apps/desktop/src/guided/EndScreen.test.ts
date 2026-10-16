import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GuidedPlan } from "@talos/core";
import { AppContext } from "../app/context";
import { fakeAdapters, fakeContextValue } from "../app/testing";
import { EndScreen } from "./EndScreen";
import { END } from "./copy";
import { guidedFor } from "./plan";

afterEach(cleanup);

function plan(overrides: Partial<GuidedPlan> = {}): GuidedPlan {
  return { reportId: "r1", freeFixes: [], steps: [], leftAlone: [], worthALook: [], technical: [], later: [], locked: [], unreadable: 0, ...overrides };
}

function renderEnd(p: GuidedPlan, fixed: readonly GuidedPlan["later"][number][]) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true }, scanState: { kind: "idle", last: null } });
  render(createElement(AppContext.Provider, { value }, createElement(EndScreen, { plan: p, fixed, onCheckAgain: vi.fn() })));
  return value.router.navigate;
}

describe("EndScreen", () => {
  it("lists the partial result as labelled rows, each one a control that opens Details", () => {
    const navigate = renderEnd(plan({ later: ["TL-MAC-001", "TL-MAC-003"], locked: ["TL-MAC-010", "TL-MAC-011", "TL-MAC-012"], leftAlone: ["TL-MAC-022"], technical: ["TL-MAC-030"], unreadable: 1 }), ["TL-MAC-002"]);
    expect(screen.getByRole("heading", { level: 1, name: END.partial })).toBeTruthy();
    expect(screen.getByText("1 thing fixed today.")).toBeTruthy();
    for (const label of [END.waiting, END.locked, END.leftAlone, END.technical]) expect(screen.getByRole("heading", { level: 2, name: label })).toBeTruthy();
    expect(document.querySelector(".guided-status-mark")).not.toBeNull();
    expect(document.querySelectorAll(".guided-summary-row").length).toBe(6);
    expect(document.querySelector(".guided-text-button")).toBeNull();
    expect(document.body.textContent).not.toContain("·");
    fireEvent.click(screen.getByRole("button", { name: `${guidedFor("TL-MAC-001").headline} ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-001" });
    fireEvent.click(screen.getByRole("button", { name: `3 things ${END.details}` }));
    fireEvent.click(screen.getByRole("button", { name: `I couldn't check 1 area. ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "findings" });
    expect(screen.getByRole("button", { name: END.checkAgain }).className).toBe("guided-link");
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
  });

  it("shows the mark and the next-time line when all done or nothing to fix, with no rows", () => {
    renderEnd(plan({ leftAlone: ["TL-MAC-022"] }), ["TL-MAC-002"]);
    expect(screen.getByRole("heading", { level: 1, name: END.allDone })).toBeTruthy();
    expect(screen.getByText(END.nextTime)).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: END.leftAlone })).toBeTruthy();
    cleanup();
    renderEnd(plan(), []);
    expect(screen.getByRole("heading", { level: 1, name: END.nothing })).toBeTruthy();
    expect(document.querySelector(".guided-status-mark")).not.toBeNull();
    expect(document.querySelector(".guided-summary")).toBeNull();
  });
});
