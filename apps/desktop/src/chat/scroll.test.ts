// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { STICK_PX, useStickToBottom } from "./scroll";

afterEach(cleanup);

function Log({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(1);
  const [forced, setForced] = useState(0);
  const { pill, scrollToBottom } = useStickToBottom(ref, count, forced, { reducedMotion });
  return createElement(
    "div",
    null,
    createElement("div", { ref, "data-testid": "log" }, String(count)),
    pill && createElement("button", { type: "button", onClick: scrollToBottom }, "New messages"),
    createElement("button", { type: "button", onClick: () => setCount((c) => c + 1) }, "append"),
    createElement("button", { type: "button", onClick: () => setForced((f) => f + 1) }, "force"),
  );
}

/** jsdom has no layout: the metrics are set by hand and scrollTo moves scrollTop. */
function geometry(el: HTMLElement, scrollTop: number) {
  Object.defineProperty(el, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 400, configurable: true });
  el.scrollTop = scrollTop;
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    el.scrollTop = options.top ?? 0;
  });
  Object.defineProperty(el, "scrollTo", { value: scrollTo, configurable: true });
  return scrollTo;
}

describe("useStickToBottom", () => {
  it("follows every new message while the person is within 48 px of the bottom, with no pill", () => {
    render(createElement(Log));
    const log = screen.getByTestId("log");
    const scrollTo = geometry(log, 600 - STICK_PX);
    fireEvent.scroll(log);
    fireEvent.click(screen.getByText("append"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "smooth" });
    expect(screen.queryByText("New messages")).toBeNull();
  });

  it("shows the pill only after a scroll-up and a new message; the tap and reaching the bottom by hand hide it", () => {
    render(createElement(Log, { reducedMotion: true }));
    const log = screen.getByTestId("log");
    const scrollTo = geometry(log, 100);
    fireEvent.scroll(log);
    expect(screen.queryByText("New messages")).toBeNull();
    fireEvent.click(screen.getByText("append"));
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByText("New messages")).not.toBeNull();
    fireEvent.click(screen.getByText("New messages"));
    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" });
    expect(screen.queryByText("New messages")).toBeNull();
    act(() => {
      log.scrollTop = 100;
    });
    fireEvent.scroll(log);
    fireEvent.click(screen.getByText("append"));
    expect(screen.getByText("New messages")).not.toBeNull();
    act(() => {
      log.scrollTop = 600;
    });
    fireEvent.scroll(log);
    expect(screen.queryByText("New messages")).toBeNull();
  });

  it("a forced scroll moves the log whatever the position and draws no pill", () => {
    render(createElement(Log));
    const log = screen.getByTestId("log");
    const scrollTo = geometry(log, 0);
    fireEvent.scroll(log);
    fireEvent.click(screen.getByText("force"));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("New messages")).toBeNull();
  });
});
