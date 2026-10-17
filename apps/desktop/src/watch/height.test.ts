import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WatchItem, WatchState } from "@talos/core";
import { fakeWatchState } from "../app/testing";
import { WATCH_WINDOW_MAX_HEIGHT, watchWindowHeight, watchWindowRows } from "./height";

const WATCH_CASES_FILE = join(__dirname, "..", "..", "..", "..", "packages", "core", "fixtures", "watch-cases.json");

interface HeightCase {
  readonly name: string;
  readonly state: WatchState;
  readonly height: number;
}

function heightCases(): readonly HeightCase[] | null {
  if (!existsSync(WATCH_CASES_FILE)) return null;
  const parsed: unknown = JSON.parse(readFileSync(WATCH_CASES_FILE, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("heights" in parsed)) return null;
  return (parsed as { heights: readonly HeightCase[] }).heights;
}

function item(overrides: Partial<WatchItem> = {}): WatchItem {
  return {
    signalId: "sig.persistence_new",
    kind: "persistence",
    severity: "high",
    points: 6,
    change: "appeared",
    changedAt: "2026-10-17T11:30:00.000Z",
    gated: false,
    snoozedUntil: null,
    hasStartupEntry: true,
    isListener: false,
    actionIds: ["act.stop_background_program"],
    modelSentence: null,
    modelProvider: null,
    ...overrides,
  };
}

const REPORT = { reportId: "demo-report", scannedAt: "2026-10-17T10:00:00.000Z", score: 72, grade: "fair" } as const;
const NEXT = { reportId: "demo-report", ruleId: "TL-MAC-001", kind: "fix" } as const;
const AI = { enabled: true, provider: "chatgpt" } as const;
const JUDGE_CALM = { provider: "chatgpt", at: "2026-10-17T11:48:00.000Z", rating: "calm", reason: "The one thing still open is your unlocked disk." } as const;
const UNREADABLE = { probeId: "probe.listeners", reason: "unsigned_build" } as const;

describe("watchWindowHeight, the shared fixture", () => {
  it("equals every heights case of watch-cases.json", () => {
    const cases = heightCases();
    if (cases === null) {
      // The fixture key is emitted by packages/core in parallel; nothing to pin until it lands.
      console.warn("watch-cases.json has no heights key yet; skipping the fixture pin");
      return;
    }
    expect(cases.length).toBeGreaterThanOrEqual(16);
    for (const row of cases) expect(watchWindowHeight(row.state), row.name).toBe(row.height);
  });
});

describe("watchWindowHeight, the rule", () => {
  it("first run is 170 and paused is 152", () => {
    expect(watchWindowHeight(fakeWatchState({ firstRun: true, lastCheckAt: null }))).toBe(170);
    expect(watchWindowRows(fakeWatchState({ firstRun: true }))).toEqual([58, 32, 32]);
    expect(watchWindowHeight(fakeWatchState({ pausedUntil: "2026-10-17T13:00:00.000Z" }))).toBe(152);
    expect(watchWindowHeight(fakeWatchState({ pausedUntil: "2026-10-17T13:00:00.000Z", lastCheckAt: null }))).toBe(124);
  });

  it("paused with an unreadable area is 172: the meta line wraps to 40 as in look and act", () => {
    const paused = { pausedUntil: "2026-10-17T13:00:00.000Z", unavailable: [UNREADABLE] } as const;
    expect(watchWindowHeight(fakeWatchState(paused))).toBe(172);
    expect(watchWindowRows(fakeWatchState(paused))).toEqual([24, 40, 20, 32]);
    expect(watchWindowRows(fakeWatchState({ ...paused, checking: true, lastCheckAt: null }))).toEqual([24, 40, 20, 32]);
    expect(watchWindowRows(fakeWatchState({ ...paused, lastCheckAt: null }))).toEqual([24, 0, 20, 32]);
  });

  it("calm with the judge, the score, Up next and the field is 332; authored 280; no report 252", () => {
    expect(watchWindowHeight(fakeWatchState({ ai: AI, judge: JUDGE_CALM, report: REPORT, next: NEXT }))).toBe(332);
    expect(watchWindowHeight(fakeWatchState({ ai: AI, report: REPORT, next: NEXT }))).toBe(280);
    expect(watchWindowHeight(fakeWatchState({ ai: AI, report: null, next: null }))).toBe(252);
  });

  it("calm: one unreadable probe adds 40 and several add 60", () => {
    const base = { ai: AI, judge: JUDGE_CALM, report: REPORT, next: NEXT } as const;
    expect(watchWindowHeight(fakeWatchState({ ...base, unavailable: [UNREADABLE] }))).toBe(380);
    expect(watchWindowHeight(fakeWatchState({ ...base, unavailable: [UNREADABLE, { probeId: "probe.remote_access", reason: "unsigned_build" }] }))).toBe(400);
    expect(watchWindowHeight(fakeWatchState({ ...base, unavailable: [UNREADABLE, { probeId: "probe.remote_access", reason: "unsigned_build" }, { probeId: "probe.file_sharing", reason: "unsigned_build" }] }))).toBe(400);
  });

  it("calm row 5: nothing with the switch off, whether or not a provider is chosen; 52 only where the Connect line is drawn", () => {
    expect(watchWindowHeight(fakeWatchState({ ai: { enabled: false, provider: null }, report: REPORT, next: NEXT }))).toBe(228);
    expect(watchWindowHeight(fakeWatchState({ ai: { enabled: false, provider: "chatgpt" }, report: REPORT, next: NEXT }))).toBe(228);
    expect(watchWindowHeight(fakeWatchState({ ai: { enabled: false, provider: null }, report: REPORT, next: NEXT }), true)).toBe(288);
    expect(watchWindowRows(fakeWatchState({ ai: { enabled: false, provider: null }, report: REPORT, next: NEXT }), true)[5]).toBe(52);
    expect(watchWindowHeight(fakeWatchState({ ai: AI, report: REPORT, next: NEXT }), true)).toBe(280);
  });

  it("calm: an On this Mac judge line is hidden and counts as the authored line; look and act keep it at 90, as the badge wraps", () => {
    const apple = { enabled: true, provider: "apple" } as const;
    expect(watchWindowHeight(fakeWatchState({ ai: apple, judge: { ...JUDGE_CALM, provider: "apple" }, report: REPORT, next: NEXT }))).toBe(280);
    expect(watchWindowRows(fakeWatchState({ ai: apple, judge: { ...JUDGE_CALM, provider: "apple" }, report: REPORT, next: NEXT }))[3]).toBe(20);
    expect(watchWindowHeight(fakeWatchState({ rating: "keep_an_eye", items: [item()], ai: apple, judge: { ...JUDGE_CALM, provider: "apple", rating: "keep_an_eye" } }))).toBe(414);
    expect(watchWindowRows(fakeWatchState({ rating: "keep_an_eye", items: [item()], ai: apple, judge: { ...JUDGE_CALM, provider: "apple", rating: "keep_an_eye" } }))[3]).toBe(90);
    const items = [item(), item({ signalId: "sig.listener_new_ports", kind: "listener" })];
    expect(watchWindowRows(fakeWatchState({ rating: "act_now", items, ai: apple, judge: { ...JUDGE_CALM, provider: "apple", rating: "act_now" } }))[5]).toBe(90);
    expect(watchWindowHeight(fakeWatchState({ rating: "act_now", items, ai: apple, judge: { ...JUDGE_CALM, provider: "apple", rating: "act_now" } }))).toBe(WATCH_WINDOW_MAX_HEIGHT);
  });

  it("calm: a judge for another rating counts as authored, and Up next needs the report ids to match", () => {
    expect(watchWindowHeight(fakeWatchState({ ai: AI, judge: { ...JUDGE_CALM, rating: "keep_an_eye" }, report: REPORT, next: NEXT }))).toBe(280);
    expect(watchWindowHeight(fakeWatchState({ ai: AI, report: REPORT, next: { ...NEXT, reportId: "other" } }))).toBe(252);
    expect(watchWindowHeight(fakeWatchState({ ai: AI, report: REPORT, next: null }))).toBe(252);
  });

  it("calm meta: 20 while checking, 20 with no check yet, 40 with a check", () => {
    expect(watchWindowRows(fakeWatchState({ ai: AI, checking: true }))[1]).toBe(20);
    expect(watchWindowRows(fakeWatchState({ ai: AI, lastCheckAt: null }))[1]).toBe(20);
    expect(watchWindowRows(fakeWatchState({ ai: AI }))[1]).toBe(40);
  });

  it("look: 396 with the reason and the link, 356 without the link, 316 without the reason, 276 with neither, 324 empty", () => {
    const look = { rating: "keep_an_eye", items: [item()] } as const;
    const judge = { ...JUDGE_CALM, rating: "keep_an_eye" } as const;
    expect(watchWindowHeight(fakeWatchState({ ...look, ai: AI, judge }))).toBe(396);
    expect(watchWindowHeight(fakeWatchState({ ...look, ai: { enabled: false, provider: "chatgpt" }, judge }))).toBe(356);
    expect(watchWindowHeight(fakeWatchState({ ...look, ai: AI }))).toBe(316);
    expect(watchWindowHeight(fakeWatchState({ ...look, ai: { enabled: false, provider: "chatgpt" } }))).toBe(276);
    expect(watchWindowHeight(fakeWatchState({ rating: "keep_an_eye", items: [], rulesSince: { reportId: "demo-report", appeared: 1 }, ai: AI, judge }))).toBe(324);
  });

  it("look and act meta is 40, not 20, with an unreadable area", () => {
    expect(watchWindowRows(fakeWatchState({ rating: "keep_an_eye", items: [item()], unavailable: [UNREADABLE] }))[1]).toBe(40);
    expect(watchWindowRows(fakeWatchState({ rating: "act_now", items: [item()], unavailable: [UNREADABLE] }))[1]).toBe(40);
    expect(watchWindowRows(fakeWatchState({ rating: "keep_an_eye", items: [item()], unavailable: [UNREADABLE], lastCheckAt: null }))[1]).toBe(0);
  });

  it("act: 404 with the reason, 324 without, 420 capped with the reason and an unreadable area; act with no item", () => {
    const items = [item(), item({ signalId: "sig.listener_new_ports", kind: "listener" }), item({ signalId: "sig.firewall", kind: "guard" })];
    const judge = { ...JUDGE_CALM, rating: "act_now" } as const;
    expect(watchWindowHeight(fakeWatchState({ rating: "act_now", items, ai: AI, judge }))).toBe(404);
    expect(watchWindowHeight(fakeWatchState({ rating: "act_now", items, ai: AI }))).toBe(324);
    expect(watchWindowHeight(fakeWatchState({ rating: "act_now", items, ai: AI, judge, unavailable: [UNREADABLE] }))).toBe(WATCH_WINDOW_MAX_HEIGHT);
    expect(watchWindowRows(fakeWatchState({ rating: "act_now", items: [], ai: AI, judge }))).toEqual([24, 20, 20, 72, 32]);
  });

  it("nextCheckAt, lastChangeAt and recentCount never change a height", () => {
    const base = fakeWatchState({ ai: AI, judge: JUDGE_CALM, report: REPORT, next: NEXT });
    const height = watchWindowHeight(base);
    expect(watchWindowHeight({ ...base, nextCheckAt: "2026-10-17T13:00:00.000Z", lastChangeAt: "2026-10-14T13:00:00.000Z", recentCount: 9 })).toBe(height);
  });
});
