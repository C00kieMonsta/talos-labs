// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CIRCUMFERENCE, FIRST_MS, ScoreMeter } from "./ScoreMeter";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.__talosDemoPace;
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

  it("replays the fill from empty on a click and keeps the meter's value", () => {
    vi.useFakeTimers();
    render(createElement(ScoreMeter, { value: 80, grade: "fair" }));
    act(() => {
      vi.advanceTimersByTime(FIRST_MS + 100);
    });
    const meter = screen.getByRole("meter");
    fireEvent.click(meter);
    const ring = document.querySelector(".score-meter-value") as SVGCircleElement;
    expect(Number(ring.getAttribute("stroke-dashoffset"))).toBeCloseTo(CIRCUMFERENCE, 1);
    expect(meter.getAttribute("aria-valuenow")).toBe("80");
    expect(meter.getAttribute("tabindex")).toBe("0");
    act(() => {
      vi.advanceTimersByTime(FIRST_MS + 100);
    });
    expect(Number(document.querySelector(".score-meter-value")?.getAttribute("stroke-dashoffset"))).toBeCloseTo(CIRCUMFERENCE * 0.2, 1);
  });

  it("does nothing on a click when motion is off", () => {
    window.__talosDemoPace = 0;
    render(createElement(ScoreMeter, { value: 80, grade: "fair" }));
    const ring = document.querySelector(".score-meter-value") as SVGCircleElement;
    expect(Number(ring.getAttribute("stroke-dashoffset"))).toBeCloseTo(CIRCUMFERENCE * 0.2, 1);
    fireEvent.click(screen.getByRole("meter"));
    expect(Number(document.querySelector(".score-meter-value")?.getAttribute("stroke-dashoffset"))).toBeCloseTo(CIRCUMFERENCE * 0.2, 1);
    expect(screen.getByText("80")).toBeTruthy();
  });

  it("renders the null state without a ring", () => {
    render(createElement(ScoreMeter, { value: null, grade: null }));
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByRole("img", { name: "No score yet" })).toBeTruthy();
    expect(document.querySelector(".score-meter-null svg")).toBeNull();
  });
});
