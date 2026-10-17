import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "@talos/core";
import { activityWord } from "./activityWord";

function event(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    id: "row",
    cardId: "card",
    kind: "fixing",
    status: "running",
    at: 0,
    endedAt: null,
    ruleId: null,
    count: null,
    step: null,
    of: null,
    probeId: null,
    sectionKey: null,
    outcome: null,
    modelLine: null,
    ...overrides,
  };
}

const CASES: readonly [string, Partial<ActivityEvent>, string][] = [
  ["running while macOS asks", { status: "running", outcome: "waiting_for_password" }, "your password"],
  ["running step of steps", { status: "running", step: 1, of: 2 }, "1 of 2"],
  ["running watcher", { status: "running", kind: "watching" }, "watching"],
  ["running stale watcher", { status: "running", kind: "watching", outcome: "stale" }, "no change yet"],
  ["running otherwise", { status: "running", kind: "preparing" }, "working"],
  ["done probe same", { status: "done", kind: "probe", outcome: "same" }, "same"],
  ["done probe changed", { status: "done", kind: "probe", outcome: "changed" }, "changed"],
  ["done probe unavailable", { status: "done", kind: "probe", outcome: "unavailable" }, "couldn't check"],
  ["done section", { status: "done", kind: "section", outcome: "now_on" }, "now on"],
  ["done otherwise", { status: "done", kind: "rechecking", outcome: "pass" }, "done"],
  ["failed command", { status: "failed", outcome: "command_failed" }, "did not change"],
  ["failed cancelled", { status: "failed", outcome: "cancelled" }, "stopped"],
  ["failed wrong password", { status: "failed", outcome: "wrong_password" }, "stopped"],
  ["failed unreadable", { status: "failed", kind: "rechecking", outcome: "unreadable" }, "couldn't check"],
  ["failed unavailable probe", { status: "failed", kind: "probe", outcome: "unavailable" }, "couldn't check"],
  ["failed still failing", { status: "failed", kind: "rechecking", outcome: "still_failing" }, "not changed yet"],
  ["failed stale watcher", { status: "failed", kind: "watching", outcome: "stale" }, "no change yet"],
  ["failed section", { status: "failed", kind: "section", outcome: "still_off" }, "still off"],
  ["failed other error", { status: "failed", outcome: "plan_expired" }, "did not change"],
  ["failed with no outcome", { status: "failed", outcome: null }, "did not change"],
];

describe("activityWord", () => {
  for (const [name, overrides, expected] of CASES) {
    it(name, () => {
      const word = activityWord(event(overrides));
      expect(word).toBe(expected);
      expect(word.length).toBeGreaterThan(0);
      expect(word).toBe(word.toLowerCase());
    });
  }

  it("never prints the model line", () => {
    const word = activityWord(event({ kind: "probe", status: "done", outcome: "changed", modelLine: "INJECT reason" }));
    expect(word).toBe("changed");
    expect(word).not.toContain("INJECT");
  });
});
