// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Finding } from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { FIX_COST_LABELS, FindingCard } from "./FindingCard";

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

  it("carries no control besides the headline link, and a text-only severity tag", () => {
    render(createElement(FindingCard, { finding: fail, onOpen: vi.fn() }));
    const article = document.querySelector("article.finding-card") as HTMLElement;
    expect(article.querySelectorAll("a, button").length).toBe(1);
    const tag = article.querySelector(".finding-row-trail .badge") as HTMLElement;
    expect(tag.classList.contains("row-tag")).toBe(true);
    expect(tag.querySelector("svg")).toBeNull();
    expect(article.querySelector(".finding-mark svg")).not.toBeNull();
  });

  it("names its severity on the row so the cue bar can follow it", () => {
    render(createElement(FindingCard, { finding: fail, onOpen: vi.fn() }));
    const article = document.querySelector("article.finding-card") as HTMLElement;
    expect(article.classList.contains(`finding-sev-${fail.severity}`)).toBe(true);
  });

  it("shows the unknown reason and no button for an unknown finding", () => {
    render(createElement(FindingCard, { finding: unknown, onOpen: vi.fn() }));
    expect(screen.getByText("Needs Full Disk Access")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
