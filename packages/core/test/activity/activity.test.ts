import { describe, expect, it } from "vitest";
import type { ActivityEvent, ActivityStrings } from "../../src/activity/index";
import { EMPTY_ACTIVITY, activityLabel, reduceActivity, rowsFor, runningFor } from "../../src/activity/index";
import { SECTION_KEYS } from "../../src/domain/system-state";
import type { SectionKey } from "../../src/domain/system-state";
import { PROBE_IDS } from "../../src/ports/watch-port";
import type { ProbeId } from "../../src/ports/watch-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";

function event(overrides: Partial<ActivityEvent> & Pick<ActivityEvent, "id" | "kind">): ActivityEvent {
  return {
    cardId: "card-1",
    status: "running",
    at: 1000,
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

const probes = Object.fromEntries(PROBE_IDS.map((id) => [id, `probe ${id.slice(6)}`])) as Record<ProbeId, string>;
const sections = Object.fromEntries(SECTION_KEYS.map((key) => [key, `Section ${key}`])) as Record<SectionKey, string>;

const STRINGS: ActivityStrings = {
  preparing: "Getting ready",
  batchAdmin: "Fixing {n} things",
  checking: "Checking it worked",
  watching: "Watching for the change",
  watchCheck: "Checking your Mac",
  verbs: { "Turn it on": "Turning it on" },
  probes,
  sections,
};

const TURN_IT_ON = MACOS_CATALOG.rules.find((r) => r.guided.verb === "Turn it on")?.id ?? "TL-MAC-002";
const SHOW_ME_WHERE = MACOS_CATALOG.rules.find((r) => r.guided.verb === "Show me where")?.id ?? "TL-MAC-001";

describe("reduceActivity", () => {
  it("upserts by id, keeps the first `at`, never re-orders, and returns the same object on a no-op", () => {
    const a = event({ id: "a", kind: "preparing", at: 10 });
    const b = event({ id: "b", kind: "fixing", at: 20, ruleId: TURN_IT_ON });
    let state = reduceActivity(reduceActivity(EMPTY_ACTIVITY, a), b);
    expect(state.events.map((e) => e.id)).toEqual(["a", "b"]);
    const aDone = event({ id: "a", kind: "preparing", at: 99, status: "done", endedAt: 30 });
    state = reduceActivity(state, aDone);
    expect(state.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(state.events[0]?.status).toBe("done");
    expect(state.events[0]?.at).toBe(10);
    expect(state.events[0]?.endedAt).toBe(30);
    const again = reduceActivity(state, aDone);
    expect(again).toBe(state);
    const unchangedEmpty = reduceActivity(EMPTY_ACTIVITY, a);
    expect(unchangedEmpty).not.toBe(EMPTY_ACTIVITY);
  });

  it("rowsFor returns one card's rows oldest first and runningFor the running one", () => {
    let state = EMPTY_ACTIVITY;
    state = reduceActivity(state, event({ id: "x:1", kind: "preparing", cardId: "x", at: 1, status: "done" }));
    state = reduceActivity(state, event({ id: "y:1", kind: "preparing", cardId: "y", at: 2 }));
    state = reduceActivity(state, event({ id: "x:2", kind: "rechecking", cardId: "x", at: 3 }));
    expect(rowsFor(state, "x").map((e) => e.id)).toEqual(["x:1", "x:2"]);
    expect(rowsFor(state, "y").map((e) => e.id)).toEqual(["y:1"]);
    expect(rowsFor(state, "z")).toEqual([]);
    expect(runningFor(state, "x")?.id).toBe("x:2");
    expect(runningFor(state, "z")).toBeNull();
  });
});

describe("activityLabel", () => {
  it("names the fix rows from the strings table", () => {
    expect(activityLabel(event({ id: "1", kind: "preparing" }), STRINGS)).toBe("Getting ready");
    expect(activityLabel(event({ id: "2", kind: "fixing", ruleId: null, count: 3 }), STRINGS)).toBe("Fixing 3 things");
    expect(activityLabel(event({ id: "3", kind: "fixing", ruleId: TURN_IT_ON }), STRINGS)).toBe("Turning it on");
    expect(activityLabel(event({ id: "4", kind: "rechecking" }), STRINGS)).toBe("Checking it worked");
    expect(activityLabel(event({ id: "5", kind: "watching" }), STRINGS)).toBe("Watching for the change");
    expect(activityLabel(event({ id: "6", kind: "watch_check" }), STRINGS)).toBe("Checking your Mac");
  });

  it("falls back to the bare verb when the table has no entry, never empty", () => {
    const label = activityLabel(event({ id: "7", kind: "fixing", ruleId: SHOW_ME_WHERE }), STRINGS);
    expect(label).toBe("Show me where");
    expect(label.length).toBeGreaterThan(0);
  });

  it("has a probe and a section label for every id, with the probe's first letter raised", () => {
    for (const probeId of PROBE_IDS) {
      const label = activityLabel(event({ id: probeId, kind: "probe", probeId }), STRINGS);
      expect(label.length).toBeGreaterThan(0);
      expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
      expect(label.toLowerCase()).toBe(probes[probeId].toLowerCase());
    }
    for (const sectionKey of SECTION_KEYS) {
      expect(activityLabel(event({ id: sectionKey, kind: "section", sectionKey }), STRINGS)).toBe(sections[sectionKey]);
    }
  });

  it("never prints the model line", () => {
    const line = "INJECT this reason";
    const kinds: ActivityEvent["kind"][] = ["preparing", "fixing", "rechecking", "watching", "watch_check", "probe", "section"];
    for (const kind of kinds) {
      const label = activityLabel(event({ id: kind, kind, probeId: "probe.firewall", sectionKey: "firewall", ruleId: kind === "fixing" ? TURN_IT_ON : null, modelLine: line }), STRINGS);
      expect(label).not.toContain("INJECT");
    }
  });
});
