import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { EMPTY_GUIDED_MEMORY, type GuidedMemory } from "../../src/guided/memory";
import { buildGuidedPlan, type GuidedStep } from "../../src/guided/plan";
import { REMINDER_HOUR, clearReminders, dueFirst, reminderDate, reminderDue, remindRules } from "../../src/guided/reminders";
import { freeFixRuleIds } from "../../src/license/entitled";
import type { ExplainerProfile } from "../../src/ports/explainer-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { ctxFor, NOW } from "../helpers";

const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));
const PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };
const PLAN = buildGuidedPlan(DEV, { freeFixes: freeFixRuleIds(DEV), licensed: true }, PROFILE, EMPTY_GUIDED_MEMORY, NOW);

/** Local noon on the given calendar day, so the day arithmetic is the local one. */
function localNoon(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12, 0, 0, 0).toISOString();
}

describe("reminderDate", () => {
  it("tomorrow is the next calendar day at 09:00 local", () => {
    const out = new Date(reminderDate(localNoon(2026, 9, 15), "tomorrow"));
    expect(out.getFullYear()).toBe(2026);
    expect(out.getMonth()).toBe(9);
    expect(out.getDate()).toBe(16);
    expect(out.getHours()).toBe(REMINDER_HOUR);
    expect(out.getMinutes()).toBe(0);
    expect(out.getSeconds()).toBe(0);
    expect(REMINDER_HOUR).toBe(9);
  });

  it("sunday is the next Sunday, and seven days on a Sunday", () => {
    // 2026-10-15 is a Thursday; 2026-10-18 the Sunday after.
    expect(new Date(localNoon(2026, 9, 15)).getDay()).toBe(4);
    const fromThursday = new Date(reminderDate(localNoon(2026, 9, 15), "sunday"));
    expect(fromThursday.getDay()).toBe(0);
    expect(fromThursday.getDate()).toBe(18);
    expect(fromThursday.getHours()).toBe(REMINDER_HOUR);
    const fromSunday = new Date(reminderDate(localNoon(2026, 9, 18), "sunday"));
    expect(fromSunday.getDay()).toBe(0);
    expect(fromSunday.getDate()).toBe(25);
    const fromSaturday = new Date(reminderDate(localNoon(2026, 9, 17), "sunday"));
    expect(fromSaturday.getDate()).toBe(18);
  });

  it("crosses a month end", () => {
    const out = new Date(reminderDate(localNoon(2026, 9, 31), "tomorrow"));
    expect(out.getMonth()).toBe(10);
    expect(out.getDate()).toBe(1);
  });
});

describe("remindRules", () => {
  const memory: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, snoozed: { "TL-MAC-002": "2026-10-22T10:00:00.000Z" }, laterCount: { "TL-MAC-002": 1 } };

  it("writes snoozed and reminders to the same date and leaves laterCount alone", () => {
    const after = remindRules(memory, ["TL-MAC-002", "TL-MAC-022"], "2026-10-16T08:00:00.000Z");
    expect(after.snoozed).toEqual({ "TL-MAC-002": "2026-10-16T08:00:00.000Z", "TL-MAC-022": "2026-10-16T08:00:00.000Z" });
    expect(after.reminders).toEqual({ "TL-MAC-002": "2026-10-16T08:00:00.000Z", "TL-MAC-022": "2026-10-16T08:00:00.000Z" });
    expect(after.laterCount).toBe(memory.laterCount);
    expect(after.accepted).toBe(memory.accepted);
    expect(memory.reminders).toEqual({});
  });

  it("returns the same object for an empty list", () => {
    expect(remindRules(memory, [], NOW)).toBe(memory);
  });
});

describe("reminderDue", () => {
  const memory: GuidedMemory = {
    ...EMPTY_GUIDED_MEMORY,
    // 001 and 002 fail on the dev machine; 004 passes; 999 is not in the report.
    reminders: { "TL-MAC-002": "2026-10-15T08:00:00.000Z", "TL-MAC-001": "2026-10-15T10:00:00.000Z", "TL-MAC-022": "2026-10-16T08:00:00.000Z", "TL-MAC-004": "2026-10-14T08:00:00.000Z", "TL-MAC-999": "2026-10-14T08:00:00.000Z" },
  };

  it("lists failing ids whose date has passed, in report order; a passing or future one is left out", () => {
    expect(reminderDue(memory, DEV, NOW)).toEqual(["TL-MAC-001", "TL-MAC-002"]);
    expect(reminderDue(memory, DEV, "2026-10-15T09:00:00.000Z")).toEqual(["TL-MAC-002"]);
    expect(reminderDue(memory, DEV, "2026-10-17T09:00:00.000Z")).toEqual(["TL-MAC-001", "TL-MAC-002", "TL-MAC-022"]);
    expect(reminderDue(EMPTY_GUIDED_MEMORY, DEV, NOW)).toEqual([]);
    expect(reminderDue(memory, DEV, "soon")).toEqual([]);
  });
});

describe("clearReminders", () => {
  const memory: GuidedMemory = { ...EMPTY_GUIDED_MEMORY, reminders: { "TL-MAC-001": NOW, "TL-MAC-002": NOW } };

  it("drops only the named ids and keeps the snooze", () => {
    const after = clearReminders({ ...memory, snoozed: { "TL-MAC-001": NOW } }, ["TL-MAC-001", "TL-MAC-999"]);
    expect(after.reminders).toEqual({ "TL-MAC-002": NOW });
    expect(after.snoozed).toEqual({ "TL-MAC-001": NOW });
  });

  it("returns the same object when nothing is present", () => {
    expect(clearReminders(memory, ["TL-MAC-999"])).toBe(memory);
    expect(clearReminders(memory, [])).toBe(memory);
  });
});

describe("dueFirst", () => {
  const steps = PLAN.steps;

  it("moves the steps naming a due id to the front and keeps both orders", () => {
    const ids = (list: readonly GuidedStep[]) => list.map((step) => step.id);
    expect(steps.length).toBeGreaterThan(2);
    const last = steps[steps.length - 1];
    const lastRule = last !== undefined && (last.kind === "fix" || last.kind === "show") ? last.ruleId : "TL-MAC-022";
    const out = dueFirst(steps, [lastRule]);
    expect(out[0]?.id).toBe(steps.find((step) => (step.kind === "fix" || step.kind === "show") && step.ruleId === lastRule)?.id);
    expect(ids(out).slice(1)).toEqual(ids(steps).filter((id) => id !== out[0]?.id));
    // A batch step moves when any of its rules is due.
    const batched = dueFirst(steps, ["TL-MAC-011"]);
    expect(batched[0]?.kind).toBe("batch");
    expect(ids(batched).length).toBe(ids(steps).length);
  });

  it("is the same array when nothing is due or no step names a due id", () => {
    expect(dueFirst(steps, [])).toBe(steps);
    expect(dueFirst(steps, ["TL-MAC-999"])).toBe(steps);
  });
});
