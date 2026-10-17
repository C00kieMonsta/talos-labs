import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { claudePromptFor, watchRequestBody, watchTurns } from "../../src/explainer/remote";
import { buildOnDeviceWatchPrompt } from "../../src/explainer/watch-prompt";
import { toWatchContext, type WatchContextInput } from "../../src/explainer/watch-context";
import { SAFE_STRING_PATTERN } from "../../src/ports/explainer-port";
import type { Change, WatchContext } from "../../src/ports/watch-port";
import { ACTION_IDS, MODEL_PROBE_IDS, PROBE_IDS, RATING_ORDER, SIGNAL_IDS } from "../../src/ports/watch-port";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { EMPTY_WATCH_MEMORY } from "../../src/watch/memory";
import type { SignalReading } from "../../src/watch/signals";
import { ctxFor } from "../helpers";
import { CANARY, CANARY_NEXT, CANARY_PROFILE, INJECT } from "../helpers/canary-state";

const NOW = "2026-10-15T11:00:00.000Z";
const CHANGES: readonly Change[] = ["same", "changed", "first_seen", "appeared", "cleared"];
const RULE_CHANGES = ["none", "appeared", "fixed", "unreadable"];
const FRESHNESS = ["fresh", "stale", "unavailable"];
const STATUSES = ["pass", "fail", "review", "unknown", "not_applicable"];
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const PROFILE_WORDS = ["individual", "freelancer", "small_business", "low", "medium", "high"];
const OS = ["macos", "windows", "linux"];
const CLOSED = new Set<string>([...CHANGES, ...RULE_CHANGES, ...FRESHNESS, ...STATUSES, ...SEVERITIES, ...PROFILE_WORDS, ...OS, ...RATING_ORDER, ...SIGNAL_IDS, ...PROBE_IDS, ...ACTION_IDS, "unknown"]);

function reading(over: Partial<SignalReading> & Pick<SignalReading, "signalId">): SignalReading {
  return { kind: "bool", value: false, previous: false, change: "same", changedAt: null, freshness: "fresh", previousFreshness: "fresh", gateAnswer: null, ...over };
}

/** The probe results a second cycle over the canary machine would reduce to. */
const READINGS: readonly SignalReading[] = [
  reading({ signalId: "sig.persistence_set", kind: "digest", value: null, previous: null, change: "changed", changedAt: "2026-10-15T10:40:00.000Z" }),
  reading({ signalId: "sig.persistence_new", kind: "count", value: 1, previous: 0, change: "changed", changedAt: "2026-10-15T10:40:00.000Z", hasStartupEntry: true, codesignValid: false }),
  reading({ signalId: "sig.persistence_in_temp_or_hidden", kind: "count", value: 1, previous: 0, change: "changed", changedAt: "2026-10-15T10:40:00.000Z" }),
  reading({ signalId: "sig.share_count", kind: "count", value: 2, previous: 1, change: "changed", changedAt: "2026-10-15T10:45:00.000Z" }),
  reading({ signalId: "sig.admin_count", kind: "count", value: 4, previous: 3, change: "changed", changedAt: "2026-10-15T10:50:00.000Z" }),
  reading({ signalId: "sig.listener_set", kind: "digest", value: null, previous: null, change: "changed", changedAt: "2026-10-15T10:41:00.000Z" }),
  reading({ signalId: "sig.listener_new_ports", kind: "count", value: 1, previous: 0, change: "changed", changedAt: "2026-10-15T10:41:00.000Z", isListener: true }),
  reading({ signalId: "sig.resolvers", kind: "digest", value: null, previous: null, change: "same" }),
  reading({ signalId: "sig.sip", value: true, previous: true }),
];

const INPUT: WatchContextInput = {
  previousReport: evaluate(CANARY, MACOS_CATALOG, ctxFor(CANARY)),
  report: evaluate(CANARY_NEXT, MACOS_CATALOG, ctxFor(CANARY_NEXT)),
  readings: READINGS,
  memory: EMPTY_WATCH_MEMORY,
  recent: [{ signalId: "sig.persistence_set", change: "changed", at: "2026-10-15T10:40:00.000Z" }],
  now: NOW,
  os: "macos",
  osVersion: CANARY_NEXT.host.osVersion,
  profile: CANARY_PROFILE,
  cycle: { index: 2, minutesSinceFullCheck: 30, minutesSinceLastChange: 10, probesLeft: 3 },
  lastVerdict: { rating: "calm", minutesAgo: 60 },
};

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe("toWatchContext over the canary pair", () => {
  const context = toWatchContext(INPUT);
  const text = JSON.stringify(context);

  it("the two reports carry the injected strings and the context carries none", () => {
    expect(JSON.stringify(INPUT.previousReport)).toContain(INJECT);
    expect(JSON.stringify(INPUT.report)).toContain(INJECT);
    expect(text).not.toContain(INJECT);
    expect(text).not.toContain("IGNORE");
  });

  it("every string is in a closed union or under SAFE_STRING_PATTERN", () => {
    for (const s of strings(context)) expect(CLOSED.has(s) || SAFE_STRING_PATTERN.test(s), s).toBe(true);
  });

  it("digest-kind signals carry only the Change and no previous", () => {
    for (const id of ["sig.persistence_set", "sig.listener_set", "sig.resolvers"] as const) {
      const signal = context.signals.find((s) => s.signalId === id);
      expect(signal?.previous, id).toBeNull();
      expect(CHANGES).toContain(signal?.value);
    }
  });

  it("the OS version from the canary falls back to unknown", () => {
    expect(context.osVersion).toBe("unknown");
    expect(toWatchContext({ ...INPUT, osVersion: "27.0.1" }).osVersion).toBe("27.0.1");
  });

  it("the rules join reads results[] with the severity from findings[] and diffs against the previous report", () => {
    expect(context.rules.length).toBeGreaterThan(0);
    expect(context.rules.length).toBeLessThanOrEqual(64);
    for (const rule of context.rules) {
      expect(rule.ruleId).toMatch(/^TL-(MAC|WIN|LNX|ANY)-[A-Za-z0-9]+$/);
      expect(RULE_CHANGES).toContain(rule.change);
      expect(Object.keys(rule)).toEqual(["ruleId", "status", "severity", "change", "minutesSinceChange"]);
    }
    const ids = context.rules.map((r) => r.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
    // Three admins became four: 011 is "review" both times, so nothing appeared; a rule unknown now reads unreadable.
    const info = context.rules.filter((r) => r.severity === "info");
    expect(info.length).toBeGreaterThan(0);
    const none = context.rules.filter((r) => r.change === "none");
    expect(none.every((r) => r.minutesSinceChange === null)).toBe(true);
  });

  it("the signals carry the canary readings reduced to enums, numbers and minutes", () => {
    expect(context.signals.map((s) => s.signalId)).toEqual(READINGS.map((r) => r.signalId));
    const admin = context.signals.find((s) => s.signalId === "sig.admin_count");
    expect(admin).toMatchObject({ value: 4, previous: 3, change: "changed", minutesSinceChange: 10, gated: true, acknowledged: false });
    expect(context.floor).toBe("act_now");
    expect(context.ceiling).toBe("act_now");
    expect(context.recent).toEqual([{ signalId: "sig.persistence_set", change: "changed", minutesAgo: 20 }]);
    expect(context.probesAvailable).toEqual(MODEL_PROBE_IDS);
    expect(context.actionsAvailable).toEqual(ACTION_IDS);
  });

  it("neither remote body carries the injected strings or a WatchDetails field name", () => {
    const bodies = [JSON.stringify(watchRequestBody("gpt-5", "i", context)), claudePromptFor(watchTurns(context)), buildOnDeviceWatchPrompt(context).text];
    for (const body of bodies) {
      expect(body).not.toContain(INJECT);
      for (const field of ["plistPath", "label", "programPath", "port", "processName", "wifiAvailable"]) expect(body, field).not.toContain(`"${field}"`);
    }
  });
});

describe("toWatchContext rules", () => {
  it("the first cycle reads every signal as same and ungated", () => {
    const first = toWatchContext({ ...INPUT, cycle: { ...INPUT.cycle, index: 0 } });
    expect(first.signals.every((s) => s.change === "same" && !s.gated)).toBe(true);
    expect(first.floor).toBe("calm");
  });

  it("a report with another schema version or no report yields no rules", () => {
    expect(toWatchContext({ ...INPUT, report: null }).rules).toEqual([]);
    const odd = { ...INPUT.report, schemaVersion: 2 } as unknown as WatchContextInput["report"];
    expect(toWatchContext({ ...INPUT, report: odd }).rules).toEqual([]);
  });

  it("memory marks a signal acknowledged: normalForMe, or three acknowledgements", () => {
    const normal = toWatchContext({ ...INPUT, memory: { ...EMPTY_WATCH_MEMORY, normalForMe: { "sig.share_count": NOW } } });
    expect(normal.signals.find((s) => s.signalId === "sig.share_count")?.acknowledged).toBe(true);
    const muted = toWatchContext({ ...INPUT, memory: { ...EMPTY_WATCH_MEMORY, acknowledgeCount: { "sig.admin_count": 3 } } });
    const admin = muted.signals.find((s) => s.signalId === "sig.admin_count");
    expect(admin?.acknowledged).toBe(true);
    expect(admin?.gated).toBe(false);
  });

  it("a gate answered mine is acknowledged; answered No it is an open act-now flip", () => {
    const mine = toWatchContext({ ...INPUT, readings: [reading({ signalId: "sig.firewall", value: false, previous: true, change: "changed", changedAt: "2026-10-15T10:50:00.000Z", gateAnswer: "mine" })] });
    expect(mine.signals[0]).toMatchObject({ acknowledged: true, gated: false });
    expect(mine.floor).toBe("calm");
    const no = toWatchContext({ ...INPUT, readings: [reading({ signalId: "sig.firewall", value: false, previous: true, change: "changed", changedAt: "2026-10-15T10:50:00.000Z", gateAnswer: "not_mine" })] });
    expect(no.signals[0]).toMatchObject({ acknowledged: false, gated: false });
    expect(no.floor).toBe("act_now");
  });

  it("a Talos fix within ten minutes of the change holds the signal; a signal that just went unavailable counts as changed", () => {
    const held = toWatchContext({ ...INPUT, readings: [reading({ signalId: "sig.gatekeeper", value: true, previous: false, change: "changed", changedAt: "2026-10-15T10:50:00.000Z", fixedByTalosAt: "2026-10-15T10:49:00.000Z" })] });
    expect(held.signals[0]?.change).toBe("same");
    const gone = toWatchContext({ ...INPUT, readings: [reading({ signalId: "sig.listener_set", kind: "digest", value: null, previous: null, freshness: "unavailable", previousFreshness: "fresh" })] });
    expect(gone.signals[0]).toMatchObject({ change: "changed", value: "changed", freshness: "unavailable", minutesSinceChange: null });
    expect(gone.floor).toBe("keep_an_eye");
    const still = toWatchContext({ ...INPUT, readings: [reading({ signalId: "sig.listener_set", kind: "digest", value: null, previous: null, change: "changed", freshness: "unavailable", previousFreshness: "unavailable" })] });
    expect(still.signals[0]?.change).toBe("same");
  });

  it("recent is capped at 20, newest first as given", () => {
    const recent = Array.from({ length: 30 }, (_, i) => ({ signalId: "sig.firewall" as const, change: "changed" as const, at: new Date(Date.parse(NOW) - i * 60_000).toISOString() }));
    const context = toWatchContext({ ...INPUT, recent });
    expect(context.recent).toHaveLength(20);
    expect(context.recent[0]?.minutesAgo).toBe(0);
    expect(context.recent[19]?.minutesAgo).toBe(19);
  });
});

describe("buildOnDeviceWatchPrompt", () => {
  const context = toWatchContext(INPUT);

  it("wraps the context as { task: 'watch', context } under the frozen instructions plus the block", () => {
    const built = buildOnDeviceWatchPrompt(context);
    expect(JSON.parse(built.text)).toEqual({ task: "watch", context });
    expect(built.instructions.endsWith("You rate, and choose probes and actions by id. You cannot run anything. The ids are the only vocabulary.")).toBe(true);
    expect(built.instructions).toContain("\n\n");
    expect(built.kept).toEqual(context.rules.map((r) => r.ruleId));
    expect(built.omitted).toBe(0);
  });

  it("over 7000 characters drops unchanged rules first, then unchanged signals, then recent", () => {
    const recent = Array.from({ length: 20 }, (_, i) => ({ signalId: "sig.firewall" as const, change: "changed" as const, minutesAgo: i }));
    const signals = SIGNAL_IDS.map((signalId) => ({ signalId, value: false as const, previous: false as const, severity: "low" as const, change: "same" as const, minutesSinceChange: null, freshness: "fresh" as const, acknowledged: false, gated: false }));
    const wide: WatchContext = { ...context, recent, signals: [...context.signals, ...signals] };
    const rules = Array.from({ length: 64 }, (_, i) => ({ ruleId: `TL-MAC-${String(i + 1).padStart(3, "0")}` as const, status: "pass" as const, severity: "low" as const, change: "none" as const, minutesSinceChange: null }));
    const built = buildOnDeviceWatchPrompt({ ...wide, rules });
    expect(built.text.length).toBeLessThanOrEqual(7000);
    const parsed = JSON.parse(built.text) as { context: WatchContext };
    expect(parsed.context.rules).toEqual([]);
    expect(parsed.context.signals.every((s) => s.change !== "same")).toBe(true);
    expect(built.omitted).toBeGreaterThanOrEqual(64 + signals.length);
    expect(built.kept).toEqual([]);
  });
});
