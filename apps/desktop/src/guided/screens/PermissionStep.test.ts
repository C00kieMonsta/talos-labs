import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import type { Capabilities } from "@talos/core";
import { AppContext } from "../../app/context";
import { fakeAdapters, fakeContextValue } from "../../app/testing";
import { buildGate } from "../../app/gate";
import { DEV_BUILD_FDA_COPY } from "../../screens/Settings";
import { PERMISSION } from "../copy";
import type { GuidedController, StepState } from "../state";
import { PermissionStep } from "./PermissionStep";

afterEach(cleanup);

function controller(state: StepState): GuidedController {
  const plan = { steps: [], locked: [], leftAlone: [] } as never;
  return {
    phase: { kind: "step", plan, index: 0, state, notice: null },
    progress: { done: 0, of: 1 },
    start: vi.fn(),
    carryOn: vi.fn(),
    primary: vi.fn(),
    doNext: vi.fn(),
    later: vi.fn(),
    next: vi.fn(),
    answer: vi.fn(),
    toggleList: vi.fn(),
    enterLicence: vi.fn(async () => undefined),
  };
}

function mount(capabilities: Capabilities | null, state: StepState = { kind: "permission", card: "watching" }) {
  const value = { ...fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: buildGate(null, { status: "none" }), scanState: { kind: "idle", report: null, last: null } }), capabilities };
  render(createElement(AppContext.Provider, { value }, createElement(PermissionStep, { state, controller: controller(state), notice: null })));
}

describe("PermissionStep dev-build hint", () => {
  it("follows the where line while watching when the binary is not bundled", () => {
    mount({ fullDiskAccess: false, automation: null, bundled: false });
    expect(screen.getByText(PERMISSION.where)).toBeTruthy();
    const hint = screen.getByText(DEV_BUILD_FDA_COPY);
    expect(hint.closest(".guided-body")).not.toBeNull();
  });

  it("keeps the bundled copy unchanged when bundled or before the probe answers", () => {
    mount({ fullDiskAccess: false, automation: null, bundled: true });
    expect(screen.getByText(PERMISSION.where)).toBeTruthy();
    expect(screen.queryByText(DEV_BUILD_FDA_COPY)).toBeNull();
    cleanup();
    mount(null);
    expect(screen.queryByText(DEV_BUILD_FDA_COPY)).toBeNull();
  });

  it("stays off the first page, which has no list to point at", () => {
    mount({ fullDiskAccess: false, automation: null, bundled: false }, { kind: "idle" });
    expect(screen.getByText(PERMISSION.body)).toBeTruthy();
    expect(screen.queryByText(DEV_BUILD_FDA_COPY)).toBeNull();
  });
});
