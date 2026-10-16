// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Finding } from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { FIX_ACTION_LABELS, FIX_COST_LABELS, FindingCard } from "./FindingCard";

afterEach(cleanup);

const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
const fail = report.findings.find((f) => f.status === "fail" && f.points > 0) as Finding;
const unknown: Finding = { ...fail, status: "unknown", unknownReason: "needs_full_disk_access", points: 0 };

describe("FindingCard", () => {
  it("opens from the headline link and shows the points and the fix-cost word", () => {
    const onOpen = vi.fn();
    render(createElement(FindingCard, { finding: fail, onOpen }));
    const article = document.querySelector("article.finding-card") as HTMLElement;
    expect(article.getAttribute("data-rule-id")).toBe(fail.ruleId);
    fireEvent.click(screen.getByRole("link", { name: fail.headline }));
    expect(onOpen).toHaveBeenCalledWith(fail.ruleId);
    expect(screen.getByText(`+${fail.points} points when fixed`)).toBeTruthy();
    expect(screen.getByText(FIX_COST_LABELS[fail.fix.apply.kind])).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the inline action for the fix kind without nesting it in the link", () => {
    const onAction = vi.fn();
    render(createElement(FindingCard, { finding: fail, onOpen: vi.fn(), onAction }));
    const button = screen.getByRole("button", { name: new RegExp(`^${FIX_ACTION_LABELS[fail.fix.apply.kind]}`) });
    expect(button.closest("a")).toBeNull();
    fireEvent.click(button);
    expect(onAction).toHaveBeenCalledWith(fail.ruleId);
  });

  it("shows the unknown reason and no action for an unknown finding", () => {
    render(createElement(FindingCard, { finding: unknown, onOpen: vi.fn(), onAction: vi.fn() }));
    expect(screen.getByText("Needs Full Disk Access")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
