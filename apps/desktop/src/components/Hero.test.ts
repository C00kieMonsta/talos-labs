// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { HORIZON_BACK, HORIZON_FRONT, Hero, RINGS_RADII } from "./Hero";

afterEach(cleanup);

describe("Hero", () => {
  it("draws the spiral in a band that clips the mark's overhang and that assistive tech never reads", () => {
    const { container } = render(createElement(Hero, { kind: "spiral", size: 400 }));
    const band = container.querySelector(".hero.hero-spiral") as HTMLElement;
    expect(band.getAttribute("aria-hidden")).toBe("true");
    // The band is the visible part only: the mark is 400 wide and sits 160 past the right edge and 120 past the top.
    expect(band.style.width).toBe("240px");
    expect(band.style.height).toBe("280px");
    expect(band.querySelector("svg")?.getAttribute("width")).toBe("400");
    expect(band.querySelector("svg path")?.getAttribute("stroke")).toBe("currentColor");
  });

  it("draws the site's seven rings and the centre dot in currentColor", () => {
    const { container } = render(createElement(Hero, { kind: "rings" }));
    const band = container.querySelector(".hero.hero-rings") as HTMLElement;
    expect(band.getAttribute("aria-hidden")).toBe("true");
    expect(band.style.width).toBe("560px");
    const rings = [...band.querySelectorAll("g circle")].map((c) => Number(c.getAttribute("r")));
    expect(rings).toEqual([...RINGS_RADII]);
    expect(band.querySelector("g")?.getAttribute("stroke")).toBe("currentColor");
    const dot = band.querySelector("svg > circle");
    expect(dot?.getAttribute("fill")).toBe("currentColor");
    expect(dot?.getAttribute("r")).toBe("3");
  });

  it("draws the horizon full width with the two dunes stretched to the band", () => {
    const { container } = render(createElement(Hero, { kind: "horizon", height: 90 }));
    const band = container.querySelector(".hero.hero-horizon") as HTMLElement;
    expect(band.getAttribute("aria-hidden")).toBe("true");
    expect(band.style.height).toBe("90px");
    expect(band.querySelector("svg")?.getAttribute("preserveAspectRatio")).toBe("none");
    const paths = [...band.querySelectorAll("path")].map((p) => p.getAttribute("d"));
    expect(paths).toEqual([HORIZON_BACK, HORIZON_FRONT]);
  });

  it("marks the spiral band as writing, and never the rings or the horizon", () => {
    const { container } = render(createElement(Hero, { kind: "spiral", writing: true }));
    expect(container.querySelector(".hero-spiral")?.getAttribute("data-writing")).toBe("true");
    cleanup();
    const still = render(createElement(Hero, { kind: "spiral", writing: false }));
    expect(still.container.querySelector(".hero-spiral")?.hasAttribute("data-writing")).toBe(false);
    cleanup();
    const rings = render(createElement(Hero, { kind: "rings", writing: true }));
    expect(rings.container.querySelector("[data-writing]")).toBeNull();
    cleanup();
    const horizon = render(createElement(Hero, { kind: "horizon", writing: true }));
    expect(horizon.container.querySelector("[data-writing]")).toBeNull();
  });
});
