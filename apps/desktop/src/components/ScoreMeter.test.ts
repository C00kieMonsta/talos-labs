// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CIRCUMFERENCE, FIRST_MS, ScoreMeter } from "./ScoreMeter";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ScoreMeter", () => {
  it("is a meter with a plain value text and the grade word", () => {
    render(createElement(ScoreMeter, { value: 38, grade: "at_risk" }));
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuenow")).toBe("38");
    expect(meter.getAttribute("aria-valuetext")).toBe("38 out of 100, at risk");
    expect(screen.getByText("At risk")).toBeTruthy();
    // The kit ring: track and fill only, no tick marks and no glyph inside.
    expect(document.querySelectorAll("line").length).toBe(0);
    expect(document.querySelector(".score-meter svg use, .score-meter-grade svg")).toBeNull();
  });

  it("reads the critical cap out with the value and draws nothing extra for it", () => {
    render(createElement(ScoreMeter, { value: 59, grade: "poor", cappedByCritical: true }));
    expect(screen.getByRole("meter").getAttribute("aria-valuetext")).toBe("59 out of 100, poor, capped by a critical issue");
    expect(document.querySelectorAll("line").length).toBe(0);
  });

  it("animates the ring from empty to the value on first mount", () => {
    vi.useFakeTimers();
    render(createElement(ScoreMeter, { value: 80, grade: "fair" }));
    const ring = document.querySelector(".score-meter-value") as SVGCircleElement;
    expect(Number(ring.getAttribute("stroke-dashoffset"))).toBeCloseTo(CIRCUMFERENCE, 1);
    act(() => {
      vi.advanceTimersByTime(FIRST_MS + 100);
    });
    expect(Number(ring.getAttribute("stroke-dashoffset"))).toBeCloseTo(CIRCUMFERENCE * 0.2, 1);
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("80");
  });

  it("renders the null state without a ring", () => {
    render(createElement(ScoreMeter, { value: null, grade: null }));
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByRole("img", { name: "No score yet" })).toBeTruthy();
    expect(document.querySelector(".score-meter-null svg")).toBeNull();
  });
});
