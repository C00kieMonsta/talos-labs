import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { createRequire } from "node:module";
import type { ActivityEvent } from "@talos/core";
import { ActivityList } from "./ActivityList";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

function event(overrides: Partial<ActivityEvent> & Pick<ActivityEvent, "id" | "kind" | "status">): ActivityEvent {
  return { cardId: "c", at: 0, endedAt: null, ruleId: null, count: null, step: null, of: null, probeId: null, sectionKey: null, outcome: null, modelLine: null, ...overrides };
}

const ROWS: ActivityEvent[] = [
  event({ id: "1", kind: "preparing", status: "done" }),
  event({ id: "2", kind: "fixing", status: "running", ruleId: null, count: 3, outcome: "waiting_for_password" }),
];

describe("ActivityList", () => {
  it("draws the row shape with icon slot, label and state word, and the key for the password row", async () => {
    const { container } = render(createElement(ActivityList, { rows: ROWS, listClass: "guided-activity" }));
    const list = container.querySelector("ul.guided-activity[role='list']");
    expect(list).not.toBeNull();
    const rows = Array.from(container.querySelectorAll("li.chat-activity-row"));
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["done", "running"]);
    expect(rows.map((r) => r.getAttribute("data-activity"))).toEqual(["preparing", "fixing"]);
    expect(rows[0]?.querySelector(".activity-icon .guided-tick")).not.toBeNull();
    expect(rows[0]?.textContent).toBe("Getting readydone");
    expect(rows[1]?.querySelector(".activity-icon .activity-key")).not.toBeNull();
    expect(rows[1]?.querySelector(".spin")).toBeNull();
    expect(rows[1]?.querySelector(".activity-word")?.textContent).toBe("your password");
    expect(rows[1]?.querySelector(".activity-label")?.textContent).toBe("Fixing 3 things");
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("[role='status']")).toBeNull();
    const result = await axe.run(container, { runOnly: ["list", "listitem"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it("spins any other running row, crosses a failed one, and announces the newest row only when asked", () => {
    const rows = [event({ id: "1", kind: "fixing", status: "failed", ruleId: "TL-MAC-002", outcome: "command_failed" }), event({ id: "2", kind: "rechecking", status: "running", count: 1 })];
    const { container } = render(createElement(ActivityList, { rows, listClass: "chat-activity", announce: true }));
    expect(container.querySelector("ul.chat-activity")).not.toBeNull();
    const items = Array.from(container.querySelectorAll("li.chat-activity-row"));
    expect(items[0]?.textContent).toBe("Turning it ondid not change");
    expect(items[1]?.querySelector(".activity-icon .spin")).not.toBeNull();
    for (const item of items) expect(item.querySelector(".activity-word")?.textContent?.length ?? 0).toBeGreaterThan(0);
    const status = container.querySelectorAll("[role='status']");
    expect(status.length).toBe(1);
    expect(status[0]?.className).toBe("visually-hidden guided-activity-status");
    expect(status[0]?.textContent).toBe("Checking it worked, working");
    expect(container.querySelector("li [role='status']")).toBeNull();
  });
});
