// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { Brand } from "./Brand";

afterEach(cleanup);

describe("Brand", () => {
  it("shows the wordmark text next to a decorative spiral", () => {
    const { container } = render(createElement(Brand));
    expect(screen.getByText("Talos Labs")).toBeTruthy();
    const svg = container.querySelector("svg.brand-mark");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("24");
    expect(svg?.querySelector("path")?.getAttribute("stroke")).toBe("currentColor");
  });

  it("takes the small size and an extra class", () => {
    const { container } = render(createElement(Brand, { size: 20, className: "sidebar-brand" }));
    expect(container.querySelector(".brand.sidebar-brand")).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("height")).toBe("20");
  });
});
