import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRequire } from "node:module";
import type { GuidedPlan, ScanReport } from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { AppContext } from "../app/context";
import { fakeAdapters, fakeContextValue } from "../app/testing";
import { EndScreen } from "./EndScreen";
import { END, NEXT } from "./copy";
import { guidedFor } from "./plan";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

const REPORT: ScanReport = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-16T10:00:00.000Z", os: "macos" });

function plan(overrides: Partial<GuidedPlan> = {}): GuidedPlan {
  return { reportId: "r1", freeFixes: [], steps: [], leftAlone: [], worthALook: [], technical: [], later: [], locked: [], unreadable: 0, ...overrides };
}

function renderEnd(p: GuidedPlan, fixed: readonly GuidedPlan["later"][number][], report: ScanReport | null = REPORT) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true }, scanState: { kind: "idle", last: report } });
  const onNext = vi.fn();
  render(createElement(AppContext.Provider, { value }, createElement(EndScreen, { plan: p, fixed, onCheckAgain: vi.fn(), onNext })));
  return { navigate: value.router.navigate, onNext };
}

describe("EndScreen", () => {
  it("lists the partial result as labelled 44 px rows with an icon and a chevron, each a control that opens Details", () => {
    const { navigate } = renderEnd(plan({ later: ["TL-MAC-010", "TL-MAC-001"], locked: ["TL-MAC-003", "TL-MAC-022"], leftAlone: ["TL-MAC-014"], technical: ["TL-MAC-029"], unreadable: 1 }), ["TL-MAC-002"]);
    expect(screen.getByRole("heading", { level: 1, name: END.partial })).toBeTruthy();
    expect(screen.getByText("1 thing fixed today.")).toBeTruthy();
    for (const label of [END.next, END.waiting, END.locked, END.leftAlone, END.technical, END.unreadable]) expect(screen.getByRole("heading", { level: 2, name: label })).toBeTruthy();
    expect(document.querySelector(".guided-status-mark .guided-status-disc circle")?.getAttribute("fill")).toBe("url(#talos-mark-gradient)");
    // 001 is the next card, so five rows remain: 010, two locked, one left alone, one technical, the unreadable line.
    const rows = document.querySelectorAll(".guided-end-row");
    expect(rows.length).toBe(6);
    for (const row of rows) expect(row.querySelectorAll("svg").length).toBe(2);
    expect(document.querySelector(".guided-text-button")).toBeNull();
    expect(document.body.textContent).not.toContain("·");
    fireEvent.click(screen.getByRole("button", { name: `${guidedFor("TL-MAC-010").headline} ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-010" });
    fireEvent.click(screen.getByRole("button", { name: `${guidedFor("TL-MAC-022").headline} ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-022" });
    fireEvent.click(screen.getByRole("button", { name: `I couldn't check 1 area. ${END.details}` }));
    expect(navigate).toHaveBeenCalledWith({ name: "findings" });
    expect(screen.getByRole("button", { name: END.checkAgain }).className).toBe("guided-link");
  });

  it("puts the biggest risk in the next card with the critical cue, its why line and the one primary button", async () => {
    const { onNext, navigate } = renderEnd(plan({ later: ["TL-MAC-010", "TL-MAC-001"], locked: ["TL-MAC-003"] }), ["TL-MAC-002"]);
    const result = await axe.run(document.body, { runOnly: ["nested-interactive", "button-name", "heading-order", "list", "listitem", "aria-valid-attr-value"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    const card = document.querySelector(".guided-next-card");
    expect(card?.className).toBe("guided-next-card guided-next-critical");
    expect(card?.querySelector(".guided-next-headline")?.textContent).toBe(guidedFor("TL-MAC-001").headline);
    expect(card?.querySelector(".guided-next-why")?.textContent).toBe(guidedFor("TL-MAC-001").why);
    expect(screen.getByText(`${guidedFor("TL-MAC-001").headline}. ${END.biggestRisk}`)).toBeTruthy();
    expect(document.querySelectorAll(".button-primary").length).toBe(1);
    expect(screen.queryByRole("button", { name: `${guidedFor("TL-MAC-001").headline} ${END.details}` })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: NEXT.show }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onNext.mock.calls[0]?.[0]).toMatchObject({ ruleId: "TL-MAC-001", kind: "show", severity: "critical" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("reads a high rule's headline as the sentence, offers Unlock for a locked rule, and the calm line with no card for a low rule left alone", () => {
    renderEnd(plan({ locked: ["TL-MAC-022"] }), ["TL-MAC-002"]);
    expect(screen.getByText(`${guidedFor("TL-MAC-022").headline}.`)).toBeTruthy();
    expect(screen.getByRole("button", { name: NEXT.unlock }).className).toContain("button-primary");
    expect(document.querySelector(".guided-next-card")?.className).toBe("guided-next-card guided-next-high");
    cleanup();
    renderEnd(plan({ later: ["TL-MAC-002"] }), []);
    expect(screen.getByRole("button", { name: NEXT.fix })).toBeTruthy();
    cleanup();
    renderEnd(plan({ leftAlone: ["TL-MAC-014"] }), ["TL-MAC-002"]);
    expect(screen.getByText(END.nextTime)).toBeTruthy();
    expect(document.querySelector(".guided-next-card")).toBeNull();
    expect(document.querySelectorAll(".guided-end-row").length).toBe(1);
  });

  it("shows the mark and the next-time line when all done or nothing to fix, with no card and no rows", () => {
    renderEnd(plan(), ["TL-MAC-002"]);
    expect(screen.getByRole("heading", { level: 1, name: END.allDone })).toBeTruthy();
    expect(screen.getByText(END.nextTime)).toBeTruthy();
    expect(document.querySelector(".guided-status-mark")).not.toBeNull();
    expect(document.querySelector(".guided-summary")).toBeNull();
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
    cleanup();
    renderEnd(plan(), [], null);
    expect(screen.getByRole("heading", { level: 1, name: END.nothing })).toBeTruthy();
    expect(document.querySelector(".guided-status-mark")).toBeNull();
    expect(document.querySelector(".guided-summary")).toBeNull();
  });

  it("says it could not check when nothing was read, with no card, and keeps the unreadable row as the route to Details", () => {
    renderEnd(plan({ unreadable: 31 }), []);
    expect(screen.getByRole("heading", { level: 1, name: END.unreadableAll })).toBeTruthy();
    expect(screen.getByText(END.tryAgain)).toBeTruthy();
    expect(screen.queryByText(END.nothing)).toBeNull();
    expect(document.querySelector(".guided-status-mark")).toBeNull();
    expect(document.querySelector(".guided-next-card")).toBeNull();
    expect(screen.getByRole("button", { name: `I couldn't check 31 areas. ${END.details}` })).toBeTruthy();
    cleanup();
    renderEnd(plan({ unreadable: 2 }), []);
    expect(screen.getByRole("heading", { level: 1, name: END.unreadableSome })).toBeTruthy();
    expect(screen.getByRole("button", { name: `I couldn't check 2 areas. ${END.details}` })).toBeTruthy();
  });
});
