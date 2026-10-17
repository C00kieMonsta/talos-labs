import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GuidedPlan, ReportDiff } from "@talos/core";
import { EMPTY_WATCH_MEMORY } from "@talos/core";
import { StatefulProvider, fakeAdapters, fakeContextValue } from "../app/testing";
import { DEFAULT_SETTINGS } from "../settings";
import type { WatchController } from "../watch/watch-controller";
import { INERT_WATCH, WatchControllerContext } from "../watch/watch-controller";
import { SinceScreen, sinceLines } from "./SinceScreen";
import { FISHY, SINCE } from "./copy";

afterEach(cleanup);

const gate = { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: true };
const DIFF: ReportDiff = { fixed: ["TL-MAC-002"], appeared: [], unreadable: [] };
const PLAN: GuidedPlan = { reportId: "r1", freeFixes: [], steps: [], leftAlone: [], worthALook: [], technical: [], later: [], locked: [], accepted: [], unreadable: 0 };

function renderSince(watch: WatchController, onCarryOn = vi.fn()) {
  const settings = { ...DEFAULT_SETTINGS, onboarded: true };
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate, scanState: { kind: "idle", last: null }, settings });
  render(createElement(StatefulProvider, { value }, createElement(WatchControllerContext.Provider, { value: watch }, createElement(SinceScreen, { diff: DIFF, plan: PLAN, onCarryOn }))));
  return onCarryOn;
}

describe("SinceScreen", () => {
  it("adds the lessons-learned line once after the fishy flow ran, and clears the mark on Carry on", () => {
    const saveMemory = vi.fn();
    const memory = { ...EMPTY_WATCH_MEMORY, fishyRanAt: "2026-10-16T10:00:00.000Z" };
    const onCarryOn = renderSince({ ...INERT_WATCH, memory, saveMemory });
    expect(screen.getByText(FISHY.lessons)).toBeTruthy();
    expect(screen.getByText(sinceLines(DIFF)[0] as string)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: SINCE.carryOn }));
    expect(saveMemory).toHaveBeenCalledWith({ ...memory, fishyRanAt: null });
    expect(onCarryOn).toHaveBeenCalledTimes(1);
  });

  it("shows no lessons line and writes nothing when the flow has not run", () => {
    const saveMemory = vi.fn();
    const onCarryOn = renderSince({ ...INERT_WATCH, memory: EMPTY_WATCH_MEMORY, saveMemory });
    expect(screen.queryByText(FISHY.lessons)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: SINCE.carryOn }));
    expect(saveMemory).not.toHaveBeenCalled();
    expect(onCarryOn).toHaveBeenCalledTimes(1);
  });
});
