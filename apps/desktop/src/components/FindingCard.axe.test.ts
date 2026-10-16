import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { createRequire } from "node:module";
import { fakeFinding } from "../app/testing";
import { FindingCard } from "./FindingCard";

const require = createRequire(import.meta.url);
// axe-core runs inside jsdom; only the nested-interactive rule matters here.
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

describe("FindingCard accessibility", () => {
  it("has no nested interactive element with an inline action", async () => {
    const finding = fakeFinding({ ruleId: "TL-MAC-002", status: "fail", headline: "The firewall is off", points: 8 });
    const { container } = render(createElement(FindingCard, { finding, onOpen: vi.fn(), onAction: vi.fn() }));
    const result = await axe.run(container, { runOnly: ["nested-interactive", "button-name", "link-name"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
    expect(container.querySelector("a.finding-card-title a, a.finding-card-title button, button a")).toBeNull();
  });
});
