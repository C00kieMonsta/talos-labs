import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../guided/copy";
import { openWalkRow, syncWalk, visibleWalkRows, walkChecklist } from "./walk";
import { AT, openedAction, planFor, run, stepById } from "./testing";
import { seedForStep } from "./cards";
import { reduce } from "./reduce";

/* AGENT part B region: the "Do them all" checklist rows (docs/DESIGN-AGENT.md 2c). */
describe("the walk checklist", () => {
  const PLAN_L = planFor(true);
  it("a step put off with Do this later keeps its pending icon and tag but leaves the visible slots and the count", () => {
    const steps = PLAN_L.steps.filter((s) => s.kind !== "paywall");
    const checklist = walkChecklist(steps);
    const opened = run([openedAction(PLAN_L)]);
    const landed = reduce(opened, { type: "card_appended", at: AT, seed: seedForStep(stepById(PLAN_L, "show:TL-MAC-001")) });
    const snoozed = reduce(landed, { type: "card_result", at: AT, cardId: landed.live as string, outcome: "snoozed", line: "OK.", rows: [] });
    const synced = syncWalk(checklist, snoozed.messages);
    const row = synced.rows.find((r) => r.stepId === "show:TL-MAC-001");
    expect(row).toMatchObject({ icon: "pending", tag: ACTIVITY.rows.anotherDay });
    expect(openWalkRow(row!)).toBe(false);
    const visible = visibleWalkRows(synced);
    expect(visible.rows.some((r) => r.stepId === "show:TL-MAC-001")).toBe(false);
    expect(visible.rows.length + visible.more).toBe(synced.rows.filter(openWalkRow).length);
    expect(synced.done).toBe(0);
  });
});
