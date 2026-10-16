// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { fakeAdapters } from "./testing";

const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
const adapters = fakeAdapters({
  reports: { saveLast: vi.fn(async () => undefined), loadLast: vi.fn(async () => report) },
});

vi.mock("../adapters", () => ({ createAdapters: () => adapters }));
// Ask stands in for any screen that throws while rendering.
vi.mock("../screens/Ask", () => ({
  Ask: () => {
    throw new Error("boom");
  },
}));
vi.mock("../settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("../settings")>();
  return {
    ...original,
    // Developer mode with Claude makes the Ask row show without an on-device probe.
    loadSettings: () => ({
      ...original.DEFAULT_SETTINGS,
      onboarded: true,
      // These tests cover the expert home; the guided check-up has its own tests under src/guided.
      guided: { home: false, autoScan: false },
      explainer: { ...original.DEFAULT_SETTINGS.explainer, provider: "claude" },
      developer: { ...original.DEFAULT_SETTINGS.developer, enabled: true },
    }),
    saveSettings: vi.fn(),
  };
});

afterEach(cleanup);

describe("App", () => {
  it("boots onto the Overview with the stored report and the free fixes", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    expect(adapters.reports.loadLast).toHaveBeenCalled();
    expect(adapters.license.current).toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ask" })).toBeTruthy();
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
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
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
});
