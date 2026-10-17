import { describe, expect, it } from "vitest";
import type { ActivityEvent, ActivityState } from "@talos/core";
import { EMPTY_ACTIVITY, activityLabel, reduceActivity, rowsFor } from "@talos/core";
import { fakeBatchPlan, fakePlan } from "../app/testing";
import type { FixingState } from "../scan/machine";
import { ACTIVITY_STRINGS } from "./ActivityList";
import { activityWord } from "./activityWord";
import { fixEvents } from "./fixActivity";

const CARD = "TL-MAC-002";

function lines(rows: readonly ActivityEvent[]): string[] {
  return rows.map((r) => `${activityLabel(r, ACTIVITY_STRINGS)} · ${activityWord(r)}`);
}

/** Folds each phase through the reducer, asserting at most one running row after every step. */
function walk(phases: readonly (FixingState | null)[], preparingFirst = true): string[][] {
  let state: ActivityState = EMPTY_ACTIVITY;
  const seen: string[][] = [];
  const steps: { fixing: FixingState | null; preparing: boolean }[] = [];
  if (preparingFirst) steps.push({ fixing: null, preparing: true });
  for (const fixing of phases) steps.push({ fixing, preparing: false });
  steps.forEach(({ fixing, preparing }, i) => {
    for (const event of fixEvents({ cardId: CARD, fixing, preparing, now: 1000 + i })) state = reduceActivity(state, event);
    const rows = rowsFor(state, CARD);
    expect(rows.filter((r) => r.status === "running").length).toBeLessThanOrEqual(1);
    seen.push(lines(rows));
  });
  return seen;
}

const admin = fakePlan({ ruleId: "TL-MAC-002", needsPassword: true });
const userLevel = fakePlan({ ruleId: "TL-MAC-013", needsPassword: false, lines: [{ text: "a", privilege: "user" }, { text: "b", privilege: "user" }] });

function single(plan = admin, phase: FixingState["phase"], extra: Partial<Extract<FixingState, { kind: "single" }>> = {}): FixingState {
  return { kind: "single", plan, phase, step: 1, of: plan.lines.length, error: null, result: null, ...extra };
}

describe("fixEvents, single", () => {
  it("an admin fix: preparing, the verb row with your password, checking, then done", () => {
    const seen = walk([single(admin, "confirm"), single(admin, "waiting_for_password"), single(admin, "running"), single(admin, "rechecking"), single(admin, "done", { result: "pass" })]);
    expect(seen[0]).toEqual(["Getting ready · working"]);
    expect(seen[2]).toEqual(["Getting ready · done", "Turning it on · your password"]);
    expect(seen[3]).toEqual(["Getting ready · done", "Turning it on · your password"]);
    expect(seen[4]).toEqual(["Getting ready · done", "Turning it on · done", "Checking it worked · working"]);
    expect(seen[5]).toEqual(["Getting ready · done", "Turning it on · done", "Checking it worked · done"]);
  });

  it("a user-level fix counts its steps", () => {
    const seen = walk([single(userLevel, "running", { step: 1, of: 2 }), single(userLevel, "running", { step: 2, of: 2 })]);
    expect(seen[1]).toEqual(["Getting ready · done", "Locking it sooner · 1 of 2"]);
    expect(seen[2]).toEqual(["Getting ready · done", "Locking it sooner · 2 of 2"]);
  });

  it("still_failing ends the recheck row failed; command_failed marks the verb row and leaves no recheck row", () => {
    const failing = walk([single(admin, "rechecking"), single(admin, "done", { result: "still_failing" })]);
    expect(failing[2]?.at(-1)).toBe("Checking it worked · not changed yet");
    const broken = walk([single(admin, "running"), single(admin, "failed", { error: "command_failed" })]);
    expect(broken[2]).toEqual(["Getting ready · done", "Turning it on · did not change"]);
    const expired = walk([single(admin, "failed", { error: "plan_expired" })]);
    expect(expired[1]).toEqual(["Getting ready · did not change"]);
  });
});

describe("fixEvents, batch", () => {
  const plan = fakeBatchPlan({
    items: [
      { ruleId: "TL-MAC-002", lines: [{ text: "a", privilege: "admin" }], recheck: ["firewall"], previous: null },
      { ruleId: "TL-MAC-008", lines: [{ text: "b", privilege: "admin" }], recheck: ["updates"], previous: null },
      { ruleId: "TL-MAC-011", lines: [{ text: "c", privilege: "admin" }], recheck: ["updates"], previous: null },
      { ruleId: "TL-MAC-013", lines: [{ text: "d", privilege: "user" }], recheck: ["screenLock"], previous: null },
    ],
    needsPassword: true,
  });
  function batch(phase: FixingState["phase"], extra: Partial<Extract<FixingState, { kind: "batch" }>> = {}): FixingState {
    return { kind: "batch", plan, phase, step: 1, of: 4, item: null, error: null, outcome: null, byRule: {}, ...extra };
  }

  it("walks preparing, the admin block, the user-level item and the recheck", () => {
    const seen = walk([batch("confirm"), batch("waiting_for_password"), batch("running", { step: 1, of: 1, item: 1 }), batch("running", { step: 1, of: 1, item: 3 }), batch("rechecking", { step: 4, item: 3 }), batch("done", { step: 4, item: 3 })]);
    expect(seen[2]).toEqual(["Getting ready · done", "Fixing 3 things · your password"]);
    expect(seen[3]).toEqual(["Getting ready · done", "Fixing 3 things · your password"]);
    expect(seen[4]).toEqual(["Getting ready · done", "Fixing 3 things · done", "Locking it sooner · 1 of 1"]);
    expect(seen[5]).toEqual(["Getting ready · done", "Fixing 3 things · done", "Locking it sooner · done", "Checking it worked · working"]);
    expect(seen[6]?.at(-1)).toBe("Checking it worked · done");
  });

  it("a cancelled dialog stops the admin block; a partial batch still rechecks", () => {
    const stopped = walk([batch("waiting_for_password"), batch("failed", { error: "wrong_password" })]);
    expect(stopped[2]).toEqual(["Getting ready · done", "Fixing 3 things · stopped"]);
    const outcome = { ok: false as const, items: [{ ruleId: "TL-MAC-013" as const, status: "failed" as const, error: "command_failed" as const, step: 0 }], error: null };
    const partial = walk([batch("running", { step: 1, of: 1, item: 3 }), batch("failed", { step: 4, item: 3, error: null, outcome })]);
    expect(partial[2]).toEqual(["Getting ready · done", "Fixing 3 things · done", "Locking it sooner · did not change", "Checking it worked · done"]);
  });

  it("a failed item reads did not change during the recheck once the outcome rides along", () => {
    const outcome = { ok: false as const, items: [{ ruleId: "TL-MAC-013" as const, status: "failed" as const, error: "command_failed" as const, step: 0 }], error: null };
    const seen = walk([batch("running", { step: 1, of: 1, item: 3 }), batch("rechecking", { step: 4, item: 3, outcome })]);
    expect(seen[2]).toEqual(["Getting ready · done", "Fixing 3 things · done", "Locking it sooner · did not change", "Checking it worked · working"]);
  });

  it("the recheck row fails when no item passed, from the verdicts", () => {
    const all = (verdict: "still_failing" | "unreadable" | "pass") => ({ "TL-MAC-002": verdict, "TL-MAC-008": verdict, "TL-MAC-011": verdict, "TL-MAC-013": verdict });
    const failing = walk([batch("rechecking", { step: 4, item: 3 }), batch("done", { step: 4, item: 3, byRule: all("still_failing") })]);
    expect(failing[2]?.at(-1)).toBe("Checking it worked · not changed yet");
    const unreadable = walk([batch("rechecking", { step: 4, item: 3 }), batch("done", { step: 4, item: 3, byRule: all("unreadable") })]);
    expect(unreadable[2]?.at(-1)).toBe("Checking it worked · couldn't check");
    const mixed = walk([batch("rechecking", { step: 4, item: 3 }), batch("done", { step: 4, item: 3, byRule: { ...all("still_failing"), "TL-MAC-013": "pass" } })]);
    expect(mixed[2]?.at(-1)).toBe("Checking it worked · done");
  });

  it("a failed admin item from the R markers marks the admin block, not the recheck", () => {
    const outcome = {
      ok: false as const,
      items: [
        { ruleId: "TL-MAC-002" as const, status: "done" as const, error: null, step: null },
        { ruleId: "TL-MAC-008" as const, status: "failed" as const, error: "command_failed" as const, step: 0 },
        { ruleId: "TL-MAC-011" as const, status: "done" as const, error: null, step: null },
        { ruleId: "TL-MAC-013" as const, status: "done" as const, error: null, step: null },
      ],
      error: null,
    };
    const seen = walk([batch("waiting_for_password"), batch("running", { step: 1, of: 1, item: 3 }), batch("failed", { step: 4, item: 3, error: null, outcome })]);
    // Two of the three admin items changed, so the block reads done; the result rows under "2 of 3 fixed." carry the failure.
    expect(seen[3]).toEqual(["Getting ready · done", "Fixing 3 things · done", "Locking it sooner · done", "Checking it worked · done"]);
    const allFailed = { ...outcome, items: outcome.items.map((o) => (o.ruleId === "TL-MAC-013" ? o : { ...o, status: "failed" as const, error: "command_failed" as const, step: 0 })) };
    const none = walk([batch("waiting_for_password"), batch("running", { step: 1, of: 1, item: 3 }), batch("failed", { step: 4, item: 3, error: null, outcome: allFailed })]);
    expect(none[3]?.[1]).toBe("Fixing 3 things · did not change");
  });

  it("a user-only batch keeps the preparing row working until the first item reports", () => {
    const userOnly = fakeBatchPlan({ items: [{ ruleId: "TL-MAC-013", lines: [{ text: "d", privilege: "user" }], recheck: ["screenLock"], previous: null }], needsPassword: false });
    const base = { kind: "batch" as const, plan: userOnly, phase: "running" as const, step: 1, of: 1, item: null, error: null, outcome: null, byRule: {} };
    const seen = walk([base, { ...base, item: 0 }]);
    expect(seen[1]).toEqual(["Getting ready · working"]);
    expect(seen[2]).toEqual(["Getting ready · done", "Locking it sooner · 1 of 1"]);
  });

  it("one admin item reads Fixing 1 thing", () => {
    const one = fakeBatchPlan({ items: [plan.items[0]!, plan.items[3]!], needsPassword: true });
    const seen = walk([{ kind: "batch", plan: one, phase: "waiting_for_password", step: 1, of: 2, item: null, error: null, outcome: null, byRule: {} }]);
    expect(seen[1]).toEqual(["Getting ready · done", "Fixing 1 thing · your password"]);
  });
});
