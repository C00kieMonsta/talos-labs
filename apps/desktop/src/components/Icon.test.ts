// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { RefreshCw } from "lucide-react";
import { CheckIcon } from "./icons";
import { Icon } from "./Icon";

afterEach(cleanup);

describe("Icon", () => {
  it("renders a kit icon decorative by default at 16 with the kit stroke", () => {
    const { container } = render(createElement(Icon, { icon: CheckIcon }));
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("width")).toBe("16");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg?.getAttribute("stroke-width")).toBe("1.5");
    expect(svg?.getAttribute("stroke")).toBe("currentColor");
  });

  it("renders a lucide icon with the same props and names it when labelled", () => {
    const { container } = render(createElement(Icon, { icon: RefreshCw, size: 20, label: "Rescan" }));
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Rescan");
    expect(svg?.getAttribute("aria-hidden")).toBeNull();
    expect(svg?.getAttribute("width")).toBe("20");
  });
});
