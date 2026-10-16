// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sheet } from "./Sheet";

afterEach(cleanup);

function mount(locked = false) {
  const onClose = vi.fn();
  render(
    createElement(Sheet, {
      title: "Turn the firewall on?",
      onClose,
      locked,
      children: [createElement("p", { key: "p" }, "Body"), createElement("button", { key: "b", type: "button" }, "Turn on")],
    }),
  );
  return onClose;
}

describe("Sheet", () => {
  it("is a modal dialog named by its title", () => {
    mount();
    const dialog = screen.getByRole("dialog", { name: "Turn the firewall on?" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("closes on Escape and on a scrim click, but not while locked", () => {
    const onClose = mount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.querySelector(".scrim") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
    cleanup();
    const lockedClose = mount(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.querySelector(".scrim") as HTMLElement);
    expect(lockedClose).not.toHaveBeenCalled();
  });

  it("keeps Tab inside the sheet", () => {
    mount();
    const close = screen.getByRole("button", { name: "Close" });
    const turnOn = screen.getByRole("button", { name: "Turn on" });
    expect(document.activeElement).toBe(close);
    turnOn.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(turnOn);
  });
});
