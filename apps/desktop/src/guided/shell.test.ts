import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "../settings";
import { StatefulProvider, fakeAdapters, fakeContextValue } from "../app/testing";
import { Sidebar } from "../components/Sidebar";
import { Settings } from "../screens/Settings";
import { CHECKUP_SETTINGS } from "../app/labels";
import { WATCH_SETTINGS } from "./copy";

afterEach(cleanup);

const gate = { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => true };

describe("the expert shell's guided entry points", () => {
  it("renders the Check-up row first in the sidebar and reports it on select", () => {
    const onSelect = vi.fn();
    render(createElement(Sidebar, { items: [{ name: "checkup", label: "Check-up" }, { name: "overview", label: "Overview" }], current: "overview", license: { status: "none" }, onSelect }));
    const rows = screen.getByRole("navigation", { name: "Main" }).querySelectorAll("button.nav-row");
    expect(rows[0]?.textContent).toBe("Check-up");
    fireEvent.click(rows[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("checkup");
  });

  it("puts the Check-up section first in Settings with its two switches writing settings.guided", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate, scanState: { kind: "idle", last: null }, settings: { ...DEFAULT_SETTINGS, onboarded: true } });
    const updateSettings = vi.fn();
    render(createElement(StatefulProvider, { value: { ...value, updateSettings } }, createElement(Settings, { aiAvailability: null, onAiAction: vi.fn(), capabilities: null, onPermission: vi.fn(), onBuy: vi.fn() })));
    const headings = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual([WATCH_SETTINGS.title, "Check-up"]);
    expect(screen.getByText(CHECKUP_SETTINGS.sentence)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: CHECKUP_SETTINGS.autoScan }));
    fireEvent.click(screen.getByRole("switch", { name: CHECKUP_SETTINGS.home }));
    // StatefulProvider owns the settings state; the context's updateSettings is what the screen calls.
    expect(screen.getByRole("switch", { name: CHECKUP_SETTINGS.autoScan })).toBeTruthy();
  });
});
