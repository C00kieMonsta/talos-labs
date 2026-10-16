// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LicenseState } from "@talos/core";
import { Sidebar } from "./Sidebar";

afterEach(cleanup);

const VALID: LicenseState = {
  status: "valid",
  payload: { v: 1, lid: "L", product: "talos-desktop", plan: "personal", seats: 1, issuedAt: "2026-01-01", updatesUntil: "2027-10-15", tag: "abcd1234" },
};

describe("Sidebar", () => {
  it("renders the nav rows with the current one selected and Settings in the foot", () => {
    const onSelect = vi.fn();
    render(createElement(Sidebar, { items: [{ name: "overview", label: "Overview" }, { name: "findings", label: "Findings" }], current: "findings", license: { status: "none" }, onSelect }));
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.querySelectorAll(".nav-row").length).toBe(2);
    const current = screen.getByRole("button", { name: "Findings" });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.classList.contains("active")).toBe(true);
    expect(screen.queryByRole("button", { name: "Ask" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onSelect).toHaveBeenCalledWith("settings");
  });

  it("shows the licence pill and sends it to Settings", () => {
    const onSelect = vi.fn();
    render(createElement(Sidebar, { items: [{ name: "overview", label: "Overview" }], current: "overview", license: VALID, onSelect }));
    const pill = screen.getByRole("button", { name: /Licensed/ });
    fireEvent.click(pill);
    expect(onSelect).toHaveBeenCalledWith("settings");
    cleanup();
    render(createElement(Sidebar, { items: [{ name: "overview", label: "Overview" }], current: "overview", license: { status: "none" }, onSelect }));
    expect(screen.getByRole("button", { name: /Free/ })).toBeTruthy();
  });

  it("goes inert and dimmed during a scan", () => {
    render(createElement(Sidebar, { items: [], current: "overview", license: { status: "none" }, dimmed: true, onSelect: vi.fn() }));
    const aside = document.querySelector("aside.sidebar") as HTMLElement;
    expect(aside.classList.contains("sidebar-dimmed")).toBe(true);
    expect(aside.hasAttribute("inert")).toBe(true);
  });
});
