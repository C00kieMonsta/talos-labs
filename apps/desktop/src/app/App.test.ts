// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { fakeAdapters } from "./testing";

const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
const adapters = fakeAdapters({
  reports: { saveLast: vi.fn(async () => undefined), loadLast: vi.fn(async () => report) },
});

vi.mock("../adapters", () => ({ createAdapters: () => adapters }));
vi.mock("../settings", async (importOriginal) => {
  const original = await importOriginal<typeof import("../settings")>();
  return {
    ...original,
    loadSettings: () => ({ ...original.DEFAULT_SETTINGS, onboarded: true }),
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
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    const titles = Array.from(document.querySelectorAll(".finding-card-title")).map((n) => n.textContent);
    expect(titles.length).toBe(3);
    expect(titles[0]).toBe("Your disk is encrypted");
  });

  it("moves focus to the new screen's heading when opening a finding and when going back", async () => {
    const { default: App } = await import("../App");
    render(createElement(App));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    const card = document.querySelector(".finding-card") as HTMLButtonElement;
    card.focus();
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByRole("button", { name: "Back" })).toBeTruthy());
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe("Your disk is encrypted");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Next three fixes" })).toBeTruthy());
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe("Overview");
  });
});
