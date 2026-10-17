import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { WATCH_INSTRUCTIONS_BLOCK, watchRequestBody } from "../../src/explainer/remote";
import { buildSystemPrompt } from "../../src/explainer/system-prompt";
import { toWatchContext, type WatchContextInput } from "../../src/explainer/watch-context";
import { WATCH_REASON_RULES, WATCH_REASON_RULES_ON_DEVICE, buildOnDeviceWatchInstructions, buildWatchJudgeInstructions } from "../../src/explainer/watch-prompt";
import type { WatchState } from "../../src/ports/watch-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { HEIGHT_CASES, baseState } from "../../src/watch/cases";
import { EMPTY_WATCH_MEMORY } from "../../src/watch/memory";
import type { SignalReading } from "../../src/watch/signals";
import { ctxFor } from "../helpers";
import { CANARY, CANARY_NEXT, CANARY_PROFILE, INJECT } from "../helpers/canary-state";

const VOCABULARY = "The ids are the only vocabulary.";

function reading(over: Partial<SignalReading> & Pick<SignalReading, "signalId">): SignalReading {
  return { kind: "bool", value: false, previous: false, change: "same", changedAt: null, freshness: "fresh", previousFreshness: "fresh", gateAnswer: null, ...over };
}

const INPUT: WatchContextInput = {
  previousReport: evaluate(CANARY, MACOS_CATALOG, ctxFor(CANARY)),
  report: evaluate(CANARY_NEXT, MACOS_CATALOG, ctxFor(CANARY_NEXT)),
  readings: [
    reading({ signalId: "sig.persistence_set", kind: "digest", value: null, previous: null, change: "changed", changedAt: "2026-10-15T10:40:00.000Z" }),
    reading({ signalId: "sig.persistence_new", kind: "count", value: 1, previous: 0, change: "changed", changedAt: "2026-10-15T10:40:00.000Z", hasStartupEntry: true, codesignValid: false }),
    reading({ signalId: "sig.listener_new_ports", kind: "count", value: 1, previous: 0, change: "changed", changedAt: "2026-10-15T10:41:00.000Z", isListener: true }),
    reading({ signalId: "sig.sip", value: true, previous: true }),
  ],
  memory: EMPTY_WATCH_MEMORY,
  recent: [{ signalId: "sig.persistence_set", change: "changed", at: "2026-10-15T10:40:00.000Z" }],
  now: "2026-10-15T11:00:00.000Z",
  os: "macos",
  osVersion: CANARY_NEXT.host.osVersion,
  profile: CANARY_PROFILE,
  cycle: { index: 2, minutesSinceFullCheck: 30, minutesSinceLastChange: 10, probesLeft: 3 },
  lastVerdict: { rating: "calm", minutesAgo: 60 },
};

describe("the judge instructions over the canary context", () => {
  const context = toWatchContext(INPUT);
  const body = watchRequestBody("gpt-test", buildWatchJudgeInstructions(), context);

  it("the user turn carries neither INJECT nor IGNORE", () => {
    expect(JSON.stringify(INPUT.report)).toContain(INJECT);
    const user = JSON.stringify(body.input);
    expect(user).not.toContain(INJECT);
    expect(user).not.toContain("IGNORE");
    expect(JSON.parse(body.input[0]?.content ?? "{}")).toEqual({ task: "watch", context });
  });

  it("the instructions carry the reason rules before the vocabulary block", () => {
    const instructions = body.instructions ?? "";
    expect(instructions).toContain(WATCH_REASON_RULES);
    expect(instructions.indexOf(WATCH_REASON_RULES)).toBeLessThan(instructions.indexOf(WATCH_INSTRUCTIONS_BLOCK));
    expect(instructions.endsWith(VOCABULARY)).toBe(true);
    expect(instructions).not.toContain(INJECT);
  });

  it("the reason rules say what the window needs and nothing about the on-device calm case", () => {
    expect(WATCH_REASON_RULES).toContain("at most 120 characters");
    expect(WATCH_REASON_RULES).toContain("in every rating");
    expect(WATCH_REASON_RULES).toContain("never I, me, my or we");
    expect(WATCH_REASON_RULES).toContain("safe, protected, secure, clean or fine");
    expect(WATCH_REASON_RULES).not.toContain("On calm, ratingReason is empty.");
    expect(buildWatchJudgeInstructions()).toBe(`${buildSystemPrompt(MACOS_CATALOG)}\n\n${WATCH_REASON_RULES}\n\n${WATCH_INSTRUCTIONS_BLOCK}`);
  });
});

describe("the on-device instructions", () => {
  it("carry the on-device rules, the empty calm reason, and end with the vocabulary sentence", () => {
    const text = buildOnDeviceWatchInstructions();
    expect(text).toContain(WATCH_REASON_RULES_ON_DEVICE);
    expect(text).toContain("On calm, ratingReason is empty.");
    expect(text.endsWith(VOCABULARY)).toBe(true);
    expect(text.indexOf(WATCH_REASON_RULES_ON_DEVICE)).toBeLessThan(text.indexOf(WATCH_INSTRUCTIONS_BLOCK));
    expect(WATCH_REASON_RULES_ON_DEVICE).not.toContain("in every rating");
  });
});

describe("HEIGHT_CASES", () => {
  const reference: WatchState = baseState();
  const keys = Object.keys(reference);

  it("every state carries every WatchState key in the reference order", () => {
    expect(keys.slice(-8)).toEqual(["nextCheckAt", "lastChangeAt", "ai", "judge", "recentCount", "rulesSince", "report", "next"]);
    expect(HEIGHT_CASES).toHaveLength(16);
    for (const c of HEIGHT_CASES) expect(Object.keys(c.state), c.name).toEqual(keys);
  });

  it("the sixteen names and heights are the ones of contract F", () => {
    expect(HEIGHT_CASES.map((c) => [c.name, c.height])).toEqual([
      ["first-run", 170],
      ["paused", 152],
      ["calm-reason", 332],
      ["calm", 280],
      ["calm-unreadable", 400],
      ["calm-not-connected", 288],
      ["calm-no-ai", 228],
      ["calm-no-report", 252],
      ["look-reason", 396],
      ["look-reason-no-link", 356],
      ["look", 316],
      ["look-plain", 276],
      ["look-empty", 324],
      ["act-reason", 404],
      ["act", 324],
      ["act-reason-unreadable", 420],
    ]);
    const unreadable = HEIGHT_CASES.find((c) => c.name === "calm-unreadable");
    expect(unreadable?.state.unavailable.map((p) => p.reason)).toEqual(["unsigned_build", "unsigned_build", "unsigned_build"]);
    for (const c of HEIGHT_CASES) {
      if (c.state.next !== null) expect(MACOS_CATALOG.rules.some((r) => r.id === c.state.next?.ruleId), c.name).toBe(true);
      expect(c.height, c.name).toBeLessThanOrEqual(420);
    }
  });
});
