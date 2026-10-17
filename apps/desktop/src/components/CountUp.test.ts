// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { MOTION } from "../app/motion";
import { CountUp } from "./CountUp";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete window.__talosDemoPace;
});

function spans(container: HTMLElement): { visible: HTMLElement; hidden: HTMLElement } {
  const visible = container.querySelector("span[aria-hidden='true']") as HTMLElement;
  const hidden = container.querySelector("span.visually-hidden") as HTMLElement;
  return { visible, hidden };
}

describe("CountUp", () => {
  it("draws a figure under ten whole, with the final value hidden for assistive tech", () => {
    const { container } = render(createElement(CountUp, { value: 3 }));
    const { visible, hidden } = spans(container);
    expect(visible.textContent).toBe("3");
    expect(visible.getAttribute("aria-hidden")).toBe("true");
    expect(hidden.textContent).toBe("3");
  });

  it("counts from 0 to a figure of ten or more over --motion-settle", () => {
    vi.useFakeTimers();
    const { container } = render(createElement(CountUp, { value: 12 }));
    const { visible, hidden } = spans(container);
    expect(visible.textContent).toBe("0");
    expect(hidden.textContent).toBe("12");
    act(() => {
      vi.advanceTimersByTime(MOTION.settle + 100);
    });
    expect(spans(container).visible.textContent).toBe("12");
    expect(spans(container).hidden.textContent).toBe("12");
  });

  it("shows the final figure at once under demo pace 0", () => {
    window.__talosDemoPace = 0;
    const { container } = render(createElement(CountUp, { value: 12 }));
    expect(spans(container).visible.textContent).toBe("12");
  });
});
