import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { ModelText } from "./ModelText";

afterEach(cleanup);

describe("ModelText", () => {
  it("renders a script tag as text, never as HTML", () => {
    const input = "<script>alert(1)</script>";
    const { container } = render(createElement(ModelText, { text: input }));
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe(input);
    expect(container.innerHTML).toContain("&lt;script&gt;");
  });

  it("renders no anchors, images or markdown for link-like text", () => {
    const input = "See [here](https://example.com) or <a href='https://x'>x</a> <img src=x onerror=alert(1)>";
    const { container } = render(createElement(ModelText, { text: input }));
    expect(container.querySelector("a, img")).toBeNull();
    expect(container.textContent).toBe(input);
  });

  it("splits blank lines into paragraphs and keeps the text", () => {
    const { container } = render(createElement(ModelText, { text: "First.\n\nSecond.\nStill second." }));
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0]?.textContent).toBe("First.");
    expect(paragraphs[1]?.textContent).toBe("Second.\nStill second.");
  });
});
