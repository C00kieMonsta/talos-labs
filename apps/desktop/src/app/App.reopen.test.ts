// @vitest-environment jsdom
// End-to-end cover for the fixInFlight guard: a main:shown while a fix waits for the password must not start a scan.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import type { FixOutcome, WatchOpenScreen } from "@talos/core";
import { fakeAdapters, fakeFixPort, fakePlan, fakeWatchPort } from "./testing";
import { PLAN, STATUS } from "../guided/copy";
import { resetLaunchGuard } from "../guided/timing";

const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
let shownListener: ((event: { screen: WatchOpenScreen }) => void) | null = null;
const watch = fakeWatchPort({
  onShown: vi.fn((listener: (event: { screen: WatchOpenScreen }) => void) => {
    shownListener = listener;
    return () => {
      shownListener = null;
    };
  }),
});
// The fix never resolves: the password box is up.
const adapters = fakeAdapters({
  reports: { saveLast: vi.fn(async () => undefined), loadLast: vi.fn(async () => report) },
  fixes: fakeFixPort(fakePlan({ ruleId: "TL-MAC-002" }), { apply: vi.fn(() => new Promise<FixOutcome>(() => undefined)) }),
  watch,
});

vi.mock("../adapters", () => ({ createAdapters: () => adapters }));
vi.mock("../settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("../settings")>();
  return {
    ...original,
    loadSettings: () => ({ ...original.DEFAULT_SETTINGS, onboarded: true, guided: { home: true, autoScan: true } }),
    saveSettings: vi.fn(),
  };
});

afterEach(() => cleanup());

describe("reopen launch check-up", () => {
  it("does not start a scan on main:shown home while a fix is waiting for the password", async () => {
    window.__talosDemoPace = 0;
    resetLaunchGuard();
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(adapters.systemState.collect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: PLAN.go })).toBeTruthy(), { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: PLAN.go }));
    await waitFor(() => expect(document.querySelector("button.guided-primary")).toBeTruthy());
    fireEvent.click(document.querySelector("button.guided-primary") as HTMLButtonElement);
    await waitFor(() => expect(adapters.fixes.apply).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(screen.getByText(STATUS.password)).toBeTruthy();
    await waitFor(() => expect(shownListener).not.toBeNull());

    resetLaunchGuard();
    act(() => shownListener?.({ screen: "home" }));
    await act(async () => undefined);
    // DESIGN-V03 section 4: never while a fix is in flight.
    expect(adapters.systemState.collect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(STATUS.password)).toBeTruthy();
  });
});
