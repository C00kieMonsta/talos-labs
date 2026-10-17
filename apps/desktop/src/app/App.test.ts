// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, MACOS_CATALOG, WATCH_REPORT_ID, buildGuidedPlan, evaluate, nextAction } from "@talos/core";
import type { LicenseState, WatchItem, WatchOpenScreen, WatchState } from "@talos/core";
import type { FixingPhase, ScanState } from "../scan/machine";
import { buildGate } from "./gate";
import { fakeAdapters, fakePlan, fakeWatchPort, fakeWatchState } from "./testing";
import { DEFAULT_SETTINGS } from "../settings";
import { FISHY, WATCH_SETTINGS } from "../guided/copy";
import { resetLaunchGuard } from "../guided/timing";

// The guided switches the settings mock reads; the launch-scan tests turn them on.
const guidedFlags = vi.hoisted(() => ({ home: false, autoScan: false, chatHome: true }));
// The recovery test makes the finding screen throw; every other test gets the real one.
const throwFlags = vi.hoisted(() => ({ finding: false }));

const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
const ACT_ITEM: WatchItem = {
  signalId: "sig.persistence_new",
  kind: "persistence",
  severity: "high",
  points: 6,
  change: "appeared",
  changedAt: "2026-10-17T13:32:00.000Z",
  gated: false,
  snoozedUntil: null,
  hasStartupEntry: true,
  isListener: false,
  actionIds: ["act.disconnect_network"],
  modelSentence: null,
  modelProvider: null,
};
// What status() answers; tests swap it before rendering. The watch:open and main:shown listeners are captured so a test can emit.
let watchState: WatchState = fakeWatchState();
let openListener: ((event: { screen: WatchOpenScreen; question?: string }) => void) | null = null;
let shownListener: ((event: { screen: WatchOpenScreen }) => void) | null = null;
const watch = fakeWatchPort({
  status: vi.fn(async () => watchState),
  onOpen: vi.fn((listener: (event: { screen: WatchOpenScreen; question?: string }) => void) => {
    openListener = listener;
    return () => {
      openListener = null;
    };
  }),
  onShown: vi.fn((listener: (event: { screen: WatchOpenScreen }) => void) => {
    shownListener = listener;
    return () => {
      shownListener = null;
    };
  }),
});
const adapters = fakeAdapters({
  reports: { saveLast: vi.fn(async () => undefined), loadLast: vi.fn(async () => report) },
  watch,
});

vi.mock("../adapters", () => ({ createAdapters: () => adapters }));
// The finding screen stands in for any expert screen that throws while rendering, behind a flag.
vi.mock("../screens/FindingDetail", async (importOriginal) => {
  const original = await importOriginal<typeof import("../screens/FindingDetail")>();
  return {
    ...original,
    FindingDetail: (props: Parameters<typeof original.FindingDetail>[0]) => {
      if (throwFlags.finding) throw new Error("boom");
      return createElement(original.FindingDetail, props);
    },
  };
});
vi.mock("../settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("../settings")>();
  return {
    ...original,
    // Developer mode with Claude makes the Chat row show without an on-device probe.
    loadSettings: () => ({
      ...original.DEFAULT_SETTINGS,
      onboarded: true,
      // Most tests cover the expert home; the guided check-up has its own tests under src/guided.
      guided: { ...guidedFlags },
      explainer: { ...original.DEFAULT_SETTINGS.explainer, provider: "claude" },
      developer: { ...original.DEFAULT_SETTINGS.developer, enabled: true },
    }),
    saveSettings: vi.fn(),
  };
});

const VALID: LicenseState = {
  status: "valid",
  payload: { v: 1, lid: "L", product: "talos-desktop", plan: "personal", seats: 1, issuedAt: "2026-01-01", updatesUntil: "2027-01-01", tag: "abcd1234" },
};
const GOOD_KEY = `TL1.${"a".repeat(24)}.${"b".repeat(64)}`;

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(watch.setProfile).mockClear();
  vi.mocked(watch.requestNotifyPermission).mockClear();
  vi.mocked(adapters.license.current).mockReset().mockResolvedValue({ status: "none" });
  vi.mocked(adapters.license.install).mockReset().mockResolvedValue({ status: "invalid", reason: "format" });
  watchState = fakeWatchState();
  guidedFlags.home = false;
  guidedFlags.autoScan = false;
  throwFlags.finding = false;
  delete window.__talosDemoPace;
});

/** The guided home with the launch check-up on, the 60 s guard cleared and the collect count at zero. */
function armLaunchScan(): void {
  guidedFlags.home = true;
  guidedFlags.autoScan = true;
  resetLaunchGuard();
  vi.mocked(adapters.systemState.collect).mockClear();
}

describe("App", () => {
  it("boots onto the Overview with the stored report and the free fixes", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    expect(adapters.reports.loadLast).toHaveBeenCalled();
    expect(adapters.license.current).toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    const titles = Array.from(document.querySelectorAll(".finding-card-title")).map((n) => n.textContent);
    expect(titles.length).toBe(3);
    expect(titles[0]).toBe("Your disk is not encrypted");
  });

  it("leaves focus alone on launch, so the first heading is not drawn with a focus ring", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("navigation", { name: "Main" }).querySelector("button.nav-row:not(.active)") as HTMLElement);
    await waitFor(() => expect(document.activeElement?.tagName).toBe("H1"));
  });

  it("moves focus to the new screen's heading when opening a finding, and back to the card on Back", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    const card = document.querySelector(".finding-card") as HTMLElement;
    const ruleId = card.getAttribute("data-rule-id");
    const link = card.querySelector("a.finding-card-title") as HTMLAnchorElement;
    link.focus();
    fireEvent.click(link);
    await waitFor(() => expect(document.querySelector("button.toolbar-back")).toBeTruthy());
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe("Your disk is not encrypted");
    fireEvent.click(document.querySelector("button.toolbar-back") as HTMLButtonElement);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    expect(document.activeElement?.classList.contains("finding-card-title")).toBe(true);
    expect(document.activeElement?.closest(".finding-card")?.getAttribute("data-rule-id")).toBe(ruleId);
  });

  it("focuses the card on Back, but the heading when the list is reached from the nav", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Findings" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Findings" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "high" } });
    fireEvent.click(document.querySelector("a.finding-card-title") as HTMLAnchorElement);
    await waitFor(() => expect(document.querySelector("button.toolbar-back")).toBeTruthy());
    fireEvent.click(document.querySelector("button.toolbar-back") as HTMLButtonElement);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Findings" })).toBeTruthy());
    expect(document.activeElement?.classList.contains("finding-card-title")).toBe(true);
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } });
    fireEvent.click(document.querySelector("a.finding-card-title") as HTMLAnchorElement);
    await waitFor(() => expect(document.querySelector("button.toolbar-back")).toBeTruthy());
    fireEvent.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Findings" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Findings" })).toBeTruthy());
    expect(document.activeElement?.tagName).toBe("H1");
  });

  it("keeps the Findings filters when a finding is opened and closed, and clears them on a fresh visit", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Findings" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Findings" })).toBeTruthy());
    const all = document.querySelectorAll(".finding-card").length;
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "network" } });
    const filtered = document.querySelectorAll(".finding-card").length;
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(all);
    fireEvent.click(document.querySelector("a.finding-card-title") as HTMLAnchorElement);
    await waitFor(() => expect(document.querySelector("button.toolbar-back")).toBeTruthy());
    fireEvent.click(document.querySelector("button.toolbar-back") as HTMLButtonElement);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Findings" })).toBeTruthy());
    expect((screen.getByLabelText("Severity") as HTMLSelectElement).value).toBe("high");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("network");
    expect(document.querySelectorAll(".finding-card").length).toBe(filtered);
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Findings" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Findings" })).toBeTruthy());
    expect((screen.getByLabelText("Severity") as HTMLSelectElement).value).toBe("all");
    expect(document.querySelectorAll(".finding-card").length).toBe(all);
  });

  it("focuses the Scanning heading when a check-up starts", async () => {
    vi.mocked(adapters.systemState.collect).mockImplementationOnce(() => new Promise(() => undefined));
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Checking your Mac" })).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Checking your Mac" }));
  });

  it("shows a recovery card instead of a blank window when a screen throws, and recovers on the next route", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { default: App } = await import("../App");
      render(createElement(App));
      await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
      throwFlags.finding = true;
      fireEvent.click(document.querySelector("a.finding-card-title") as HTMLAnchorElement);
      const heading = await screen.findByRole("heading", { name: "This screen could not be shown" });
      expect(document.activeElement).toBe(heading);
      expect(screen.getByText(/Something went wrong while drawing this screen/)).toBeTruthy();
      expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Rescan" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
      await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy());
      expect(screen.queryByText("This screen could not be shown")).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });

  it("lets the user dismiss a failed check-up instead of carrying the banner to every screen", async () => {
    vi.mocked(adapters.systemState.collect).mockRejectedValueOnce("cancelled");
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));
    await waitFor(() => expect(screen.getByText(/You cancelled the check-up/)).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss this message" }));
    await waitFor(() => expect(screen.queryByText(/You cancelled the check-up/)).toBeNull());
    expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeTruthy();
  });

  it("mounts the watch controller: status() and autostartIsEnabled() once, the profile pushed with the AI choice, and no setter on its own", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(watch.setProfile).toHaveBeenCalled());
    expect(watch.status).toHaveBeenCalled();
    expect(watch.autostartIsEnabled).toHaveBeenCalled();
    // Developer mode with the Claude API provider: the AI layer is on in the webview, but the watch has no consumer provider to call. No licence: false.
    expect(watch.setProfile).toHaveBeenLastCalledWith(expect.objectContaining({ role: "individual" }), { enabled: false, provider: null }, false, [], null);
    expect(watch.setEnabled).not.toHaveBeenCalled();
    expect(watch.setInterval).not.toHaveBeenCalled();
    expect(watch.setNotify).not.toHaveBeenCalled();
    expect(watch.requestNotifyPermission).not.toHaveBeenCalled();
    expect(watch.autostartEnable).not.toHaveBeenCalled();
    expect(openListener).not.toBeNull();
  });

  it("pushes the gate only once the licence is read: true for a valid licence, nothing while the read is pending, nothing when it rejects", async () => {
    let resolve: (state: LicenseState) => void = () => undefined;
    vi.mocked(adapters.license.current).mockImplementationOnce(() => new Promise<LicenseState>((r) => (resolve = r)));
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(watch.status).toHaveBeenCalled());
    await act(async () => undefined);
    expect(watch.setProfile).not.toHaveBeenCalled();
    await act(async () => resolve(VALID));
    await waitFor(() => expect(watch.setProfile).toHaveBeenCalledTimes(1));
    expect(watch.setProfile).toHaveBeenLastCalledWith(expect.objectContaining({ role: "individual" }), { enabled: false, provider: null }, true, [], null);
    expect(watch.requestNotifyPermission).not.toHaveBeenCalled();
    cleanup();
    vi.mocked(watch.setProfile).mockClear();
    vi.mocked(adapters.license.current).mockRejectedValueOnce("command_failed");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(watch.status).toHaveBeenCalled());
    await act(async () => undefined);
    expect(watch.setProfile).not.toHaveBeenCalled();
  });

  it("the paste that licenses asks for notification permission once, a second paste does not, and a boot with a licence never does", async () => {
    vi.mocked(adapters.license.install).mockResolvedValue(VALID);
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(watch.setProfile).toHaveBeenCalledWith(expect.anything(), expect.anything(), false, [], null));
    expect(watch.requestNotifyPermission).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector(".sidebar-foot button.nav-row") as HTMLElement);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy());
    expect(document.getElementById("watch-heading")).toBeNull();
    const paste = async () => {
      const input = screen.getByLabelText("Licence key") as HTMLInputElement;
      fireEvent.change(input, { target: { value: GOOD_KEY } });
      fireEvent.click(screen.getByRole("button", { name: "Activate" }));
      await waitFor(() => expect(document.getElementById("watch-heading")).not.toBeNull());
    };
    await paste();
    await waitFor(() => expect(watch.requestNotifyPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(watch.setProfile).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), true, [], null));
    expect(JSON.parse(localStorage.getItem("talos.watch") ?? "{}").notifyAskedAt).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByLabelText("Licence key")).toBeTruthy());
    await waitFor(() => expect(watch.setProfile).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), false, [], null));
    await paste();
    await act(async () => undefined);
    expect(watch.requestNotifyPermission).toHaveBeenCalledTimes(1);
  });

  it("a boot with a licence pushes true and never asks for notification permission", async () => {
    vi.mocked(adapters.license.current).mockResolvedValueOnce(VALID);
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(watch.setProfile).toHaveBeenCalled());
    expect(watch.setProfile).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), true, [], null);
    await act(async () => undefined);
    expect(watch.requestNotifyPermission).not.toHaveBeenCalled();
  });

  it("pushes the plan's next action as the fifth argument once the launch check-up lands, and null while there is no plan", async () => {
    armLaunchScan();
    // Pace 0 collapses the reveal so the plan lands at once.
    window.__talosDemoPace = 0;
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(watch.setProfile).toHaveBeenCalled());
    expect(watch.setProfile).toHaveBeenCalledWith(expect.anything(), expect.anything(), false, [], null);
    // The same plan the guide builds for an unlicensed dev machine; the paywall kind reads as the finding on the wire.
    const gate = buildGate(report, { status: "none" });
    const plan = buildGuidedPlan(report, { freeFixes: gate.freeFixes, licensed: false }, DEFAULT_SETTINGS.profile, EMPTY_GUIDED_MEMORY, report.scannedAt);
    const next = nextAction(plan, report);
    expect(next).not.toBeNull();
    const row = { reportId: expect.stringMatching(WATCH_REPORT_ID), ruleId: next?.ruleId, kind: next?.kind === "unlock" ? "details" : next?.kind };
    await waitFor(() => expect(watch.setProfile).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), false, [], row), { timeout: 5000 });
    expect(vi.mocked(watch.setProfile).mock.calls.at(-1)).toHaveLength(5);
  });

  it("opens the fishy flow on watch:open noticed when the watch has an item, and the link leads back", async () => {
    watchState = fakeWatchState({ rating: "act_now", items: [ACT_ITEM] });
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(watch.status).toHaveBeenCalled());
    await waitFor(() => expect(openListener).not.toBeNull());
    // The controller holds the state only after status() resolved; give it a turn.
    await act(async () => undefined);
    act(() => openListener?.({ screen: "noticed" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: FISHY.noticed.headline.persistence })).toBeTruthy());
    expect(document.querySelectorAll(".button-primary").length).toBe(1);
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    // A second noticed while the flow is on screen (the window's button pressed again, a tap on the banner) adds no second entry.
    act(() => openListener?.({ screen: "noticed" }));
    await act(async () => undefined);
    expect(screen.getByRole("heading", { name: FISHY.noticed.headline.persistence })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: FISHY.noticed.link }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    expect(screen.queryByRole("heading", { name: FISHY.noticed.headline.persistence })).toBeNull();
    expect(watch.acknowledge).toHaveBeenCalledWith("sig.persistence_new");
  });

  it("leaves the screen alone on watch:open noticed when the state reports licensed false, whatever it carries", async () => {
    watchState = fakeWatchState({ licensed: false, rating: "act_now", items: [ACT_ITEM] });
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(openListener).not.toBeNull());
    await act(async () => undefined);
    act(() => openListener?.({ screen: "noticed" }));
    await act(async () => undefined);
    expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: FISHY.noticed.headline.persistence })).toBeNull();
  });

  it("leaves the screen alone on watch:open noticed with no item, and on home", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(openListener).not.toBeNull());
    await act(async () => undefined);
    act(() => openListener?.({ screen: "noticed" }));
    act(() => openListener?.({ screen: "home" }));
    await act(async () => undefined);
    expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: FISHY.noticed.headline.persistence })).toBeNull();
  });

  it("holds the launch check-up on a hidden --watch launch until the window is shown on home", async () => {
    armLaunchScan();
    watchState = fakeWatchState({ hiddenLaunch: true });
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(watch.status).toHaveBeenCalled());
    await waitFor(() => expect(shownListener).not.toBeNull());
    await act(async () => undefined);
    expect(adapters.systemState.collect).not.toHaveBeenCalled();
    // A notification tap lands on the fishy flow or the end screen, not on a fresh check-up.
    act(() => shownListener?.({ screen: "noticed" }));
    await act(async () => undefined);
    expect(adapters.systemState.collect).not.toHaveBeenCalled();
    act(() => shownListener?.({ screen: "home" }));
    await waitFor(() => expect(adapters.systemState.collect).toHaveBeenCalledTimes(1));
  });

  it("a chat open from the menu bar window on a hidden launch counts as home: the launch check-up runs", async () => {
    armLaunchScan();
    watchState = fakeWatchState({ hiddenLaunch: true });
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(shownListener).not.toBeNull());
    await act(async () => undefined);
    expect(adapters.systemState.collect).not.toHaveBeenCalled();
    act(() => shownListener?.({ screen: "chat" }));
    await waitFor(() => expect(adapters.systemState.collect).toHaveBeenCalledTimes(1));
  });

  it("runs the launch check-up again when the hidden window is shown, as closing it no longer ends the process", async () => {
    armLaunchScan();
    // The launch scan ends at once so the second start is not refused as a scan in flight.
    vi.mocked(adapters.systemState.collect).mockRejectedValueOnce("cancelled");
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(adapters.systemState.collect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(shownListener).not.toBeNull());
    await act(async () => undefined);
    // The same show within 60 s of the launch is not a second scan.
    act(() => shownListener?.({ screen: "home" }));
    await act(async () => undefined);
    expect(adapters.systemState.collect).toHaveBeenCalledTimes(1);
    resetLaunchGuard();
    act(() => shownListener?.({ screen: "home" }));
    await waitFor(() => expect(adapters.systemState.collect).toHaveBeenCalledTimes(2));
  });

  it("opens the chat in the guided shell on watch:open chat and holds the question as a draft; connect opens the Connect screen", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(openListener).not.toBeNull());
    act(() => openListener?.({ screen: "chat", question: "why does the firewall matter" }));
    await waitFor(() => expect(document.querySelector(".guided-shell")).toBeTruthy());
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    // No report was scanned, so no chat can open and nothing was asked of a model; the draft waits in App.
    expect(document.querySelector(".chat-composer")).toBeNull();
    act(() => openListener?.({ screen: "connect" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Which AI do you use?" })).toBeTruthy());
    // A second connect while the screen is up adds no second entry.
    act(() => openListener?.({ screen: "connect" }));
    await act(async () => undefined);
    expect(screen.getAllByRole("heading", { name: "Which AI do you use?" }).length).toBe(1);
  });

  it("goes to the Watch section of Settings on watch:open settings_watch", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    // The tray exists only while licensed, so the anchor is reached on a licensed Mac.
    vi.mocked(adapters.license.current).mockResolvedValueOnce(VALID);
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    await waitFor(() => expect(openListener).not.toBeNull());
    act(() => openListener?.({ screen: "settings_watch" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy());
    expect(screen.getByRole("heading", { level: 2, name: WATCH_SETTINGS.title })).toBeTruthy();
    expect(document.getElementById("watch-heading")).toBeTruthy();
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });
});

describe("fixInFlight", () => {
  const ready = (over: Partial<Extract<ScanState, { kind: "ready" }>> = {}): ScanState => ({ kind: "ready", report, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null, ...over });
  const fixing = (phase: FixingPhase): Extract<ScanState, { kind: "ready" }>["fixing"] => ({ kind: "single", plan: fakePlan({ ruleId: "TL-MAC-002" }), phase, step: 0, of: 0, error: null, result: null });

  it("is true while a fix waits for the password, runs or rechecks, while a watcher waits, and during a recheck; false otherwise", async () => {
    const { fixInFlight } = await import("../App");
    expect(fixInFlight({ kind: "idle", last: null })).toBe(false);
    expect(fixInFlight(ready())).toBe(false);
    for (const phase of ["confirm", "waiting_for_password", "running", "rechecking"] as const) expect(fixInFlight(ready({ fixing: fixing(phase) })), phase).toBe(true);
    for (const phase of ["done", "failed"] as const) expect(fixInFlight(ready({ fixing: fixing(phase) })), phase).toBe(false);
    expect(fixInFlight(ready({ watching: { ruleId: "TL-MAC-026", since: "2026-10-17T12:00:00.000Z", stale: false, passedAt: null } as never }))).toBe(true);
    // A watcher that already passed is finished; the reopen launch scan may run.
    expect(fixInFlight(ready({ watching: { ruleId: "TL-MAC-026", since: "2026-10-17T12:00:00.000Z", stale: false, passedAt: "2026-10-17T12:05:00.000Z" } as never }))).toBe(false);
    expect(fixInFlight({ kind: "rechecking", report, state: DEV_MACHINE, key: "security", explain: { kind: "off" }, watching: null } as never)).toBe(true);
  });
});
