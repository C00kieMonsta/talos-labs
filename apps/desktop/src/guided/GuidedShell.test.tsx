// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import type { ScanReport } from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { AppContext } from "../app/context";
import { fakeAdapters, fakeContextValue } from "../app/testing";
import type { ExplainState, ReadyState } from "../scan/machine";
import { GuidedShell, useGuidedHero } from "./GuidedShell";

afterEach(cleanup);

const REPORT: ScanReport = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-16T10:00:00.000Z", os: "macos" });
const RUNNING: ExplainState = { kind: "running", target: "TL-MAC-001", partial: null, answerPartial: null, from: { byRule: {}, order: null, priority: null } };

function ready(explain: ExplainState): ReadyState {
  return { kind: "ready", report: REPORT, state: DEV_MACHINE, explain, lastRecheck: null, fixing: null, watching: null };
}

function WantsSpiral({ writing = false }: { writing?: boolean }) {
  useGuidedHero(true, false, writing);
  return createElement("p", null, "step");
}

function WantsNothing() {
  useGuidedHero(false, false);
  return createElement("p", null, "step");
}

function tree(explain: ExplainState, child: React.ReactNode) {
  const value = fakeContextValue({
    adapters: fakeAdapters(),
    license: { status: "none" },
    gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: true },
    scanState: ready(explain),
  });
  return createElement(AppContext.Provider, { value }, createElement(GuidedShell, { inactive: false, children: child }));
}

describe("GuidedShell", () => {
  it("marks the spiral band as writing while the explain slot runs, and clears it when it stops", () => {
    const { container, rerender } = render(tree(RUNNING, createElement(WantsSpiral)));
    expect(container.querySelector("[data-testid='hero-spiral'][data-writing='true']")).not.toBeNull();
    rerender(tree({ kind: "off" }, createElement(WantsSpiral)));
    const band = container.querySelector("[data-testid='hero-spiral']") as HTMLElement;
    expect(band).not.toBeNull();
    expect(band.hasAttribute("data-writing")).toBe(false);
  });

  it("takes the screen's own writing flag", () => {
    const { container } = render(tree({ kind: "off" }, createElement(WantsSpiral, { writing: true })));
    expect(container.querySelector("[data-testid='hero-spiral'][data-writing='true']")).not.toBeNull();
  });

  it("renders no band when the screen asks for none", () => {
    const { container } = render(tree(RUNNING, createElement(WantsNothing)));
    expect(container.querySelector("[data-testid='hero-spiral']")).toBeNull();
    expect(container.querySelector("[data-testid='hero-horizon']")).toBeNull();
  });
});
