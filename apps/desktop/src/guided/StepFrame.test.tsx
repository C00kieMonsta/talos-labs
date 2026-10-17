import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { createRequire } from "node:module";
import type { ActivityEvent } from "@talos/core";
import { AppContext } from "../app/context";
import { fakeAdapters, fakeContextValue } from "../app/testing";
import { StepFrame } from "./StepFrame";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };
const AXE_RULES = ["nested-interactive", "button-name", "heading-order", "aria-valid-attr-value", "aria-progressbar-name", "list", "listitem"];

afterEach(cleanup);

function renderStep(props: Parameters<typeof StepFrame>[0]) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: true }, scanState: { kind: "idle", last: null } });
  return render(createElement(AppContext.Provider, { value }, createElement(StepFrame, props)));
}

function event(overrides: Partial<ActivityEvent> & Pick<ActivityEvent, "id" | "kind" | "status">): ActivityEvent {
  return { cardId: "TL-MAC-002", at: 0, endedAt: null, ruleId: null, count: null, step: null, of: null, probeId: null, sectionKey: null, outcome: null, modelLine: null, ...overrides };
}

const ROWS: ActivityEvent[] = [
  event({ id: "1", kind: "preparing", status: "done" }),
  event({ id: "2", kind: "fixing", status: "done", ruleId: "TL-MAC-002" }),
  event({ id: "3", kind: "rechecking", status: "running", count: 1 }),
];

describe("StepFrame activity rows", () => {
  it("replaces the status line with the rows, one announcer beside the heading's, and no primary", async () => {
    const { container } = renderStep({ progress: { done: 1, of: 5 }, title: "The firewall is off", status: "Working", activity: ROWS });
    expect(container.querySelector(".guided-status")).toBeNull();
    expect(container.querySelector("ul.guided-activity")).not.toBeNull();
    expect(container.querySelectorAll("li.chat-activity-row").length).toBe(3);
    const status = Array.from(container.querySelectorAll("[role='status']"));
    expect(status.length).toBe(2);
    expect(status[0]?.className).toBe("visually-hidden");
    expect(status[1]?.className).toBe("visually-hidden guided-activity-status");
    expect(status[1]?.textContent).toBe("Checking it worked, working");
    expect(container.querySelectorAll(".button-primary").length).toBe(0);
    expect(container.querySelector("[data-state='running'] .spin")).not.toBeNull();
    expect(container.querySelectorAll("[data-state='running']").length).toBe(1);
    expect(container.querySelector("li [aria-live]")).toBeNull();
    const result = await axe.run(container, { runOnly: AXE_RULES });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it("keeps the status line while the rows are empty or withheld", () => {
    const empty = renderStep({ progress: { done: 1, of: 5 }, title: "The firewall is off", status: "Getting ready", activity: [] });
    expect(empty.container.querySelector(".guided-status")?.textContent).toBe("Getting ready");
    expect(empty.container.querySelector("ul.guided-activity")).toBeNull();
    cleanup();
    const withheld = renderStep({ progress: { done: 1, of: 5 }, title: "The firewall is off", status: "Waiting for macOS", activity: null });
    expect(withheld.container.querySelector(".guided-status")?.textContent).toBe("Waiting for macOS");
    expect(withheld.container.querySelector("ul.guided-activity")).toBeNull();
  });
});
