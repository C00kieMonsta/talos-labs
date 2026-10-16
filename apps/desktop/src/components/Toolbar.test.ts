// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RefreshCw } from "lucide-react";
import { Toolbar } from "./Toolbar";

afterEach(cleanup);

describe("Toolbar", () => {
  it("puts the title in an h1 and names icon buttons with hidden text", () => {
    const onClick = vi.fn();
    render(createElement(Toolbar, { title: "Overview", subtitle: "Last check-up 20:37", actions: [{ label: "Rescan", icon: RefreshCw, onClick }] }));
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeTruthy();
    expect(screen.getByText("Last check-up 20:37")).toBeTruthy();
    const button = screen.getByRole("button", { name: "Rescan" });
    expect(button.getAttribute("title")).toBe("Rescan");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalled();
  });

  it("renders a back button and no h1 when the screen owns its heading", () => {
    const onClick = vi.fn();
    render(createElement(Toolbar, { back: { label: "Findings", onClick } }));
    expect(screen.queryByRole("heading")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Findings" }));
    expect(onClick).toHaveBeenCalled();
  });
});
