import type { Severity } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { Os } from "../domain/system-state";
import { SAFE_STRING_PATTERN, type ExplainerProfile } from "../ports/explainer-port";
import type { Change, RuleChange, SignalId, WatchContext, WatchCycle, WatchLastVerdict, WatchMemory, WatchRule, WatchSignal } from "../ports/watch-port";
import { ACTION_IDS, MODEL_PROBE_IDS, WATCH_LIMITS } from "../ports/watch-port";
import { isMuted } from "../watch/memory";
import { boundsFor } from "../watch/rate";
import { GATED_SIGNALS, SIGNAL_SEVERITY, badFlip, type SignalReading } from "../watch/signals";
import { UNKNOWN_OS_VERSION } from "./context";

/** Rows whose id does not match never reach the model. */
export const WATCH_RULE_ID = /^TL-(MAC|WIN|LNX|ANY)-[A-Za-z0-9]+$/;

/** A Talos fix this close to a change holds the signal for one cycle. */
const NOISE_HOLD_MS = 10 * 60 * 1000;

export interface WatchContextInput {
  readonly previousReport: ScanReport | null;
  readonly report: ScanReport | null;
  readonly readings: readonly SignalReading[];
  readonly memory: WatchMemory;
  /** The stored change history, newest first; the first 20 reach the context. */
  readonly recent: readonly { readonly signalId: SignalId; readonly change: Change; readonly at: string }[];
  readonly now: string;
  readonly os: Os;
  readonly osVersion: string;
  readonly profile: ExplainerProfile;
  readonly cycle: WatchCycle;
  readonly lastVerdict: WatchLastVerdict | null;
}

function minutesBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 60_000));
}

function attention(status: string): boolean {
  return status === "fail" || status === "review";
}

/** results[] joined with findings[] for the severity, diffed against the previous report; 64 rows at most. */
function rulesFor(report: ScanReport | null, previous: ScanReport | null, now: string): WatchRule[] {
  if (report === null || report.schemaVersion !== 1) return [];
  const severities = new Map<string, Severity>();
  for (const finding of report.findings) severities.set(finding.ruleId, finding.severity);
  const before = new Map<string, string>();
  if (previous !== null && previous.schemaVersion === 1) {
    for (const result of previous.results) if (!before.has(result.ruleId)) before.set(result.ruleId, result.status);
  }
  const out: WatchRule[] = [];
  const seen = new Set<string>();
  for (const result of report.results) {
    if (!WATCH_RULE_ID.test(result.ruleId) || seen.has(result.ruleId)) continue;
    if (out.length >= WATCH_LIMITS.maxRules) break;
    seen.add(result.ruleId);
    const was = before.get(result.ruleId);
    let change: RuleChange = "none";
    if (result.status === "unknown") change = "unreadable";
    else if (was !== undefined && !attention(was) && attention(result.status)) change = "appeared";
    else if (was !== undefined && attention(was) && !attention(result.status)) change = "fixed";
    out.push({
      ruleId: result.ruleId,
      status: result.status,
      severity: severities.get(result.ruleId) ?? "info",
      change,
      minutesSinceChange: change === "none" ? null : minutesBetween(report.scannedAt, now),
    });
  }
  return out;
}

function held(reading: SignalReading): boolean {
  const fixedAt = reading.fixedByTalosAt ?? null;
  if (fixedAt === null || reading.changedAt === null) return false;
  const a = Date.parse(fixedAt);
  const b = Date.parse(reading.changedAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= NOISE_HOLD_MS;
}

/** The first cycle writes the baseline and counts nothing; a change only ever counts against an existing baseline. */
function signalFor(reading: SignalReading, memory: WatchMemory, now: string, firstCycle: boolean): WatchSignal {
  let change: Change = reading.change;
  if (firstCycle) change = "same";
  else if (reading.freshness === "unavailable") change = reading.previousFreshness === "fresh" ? "changed" : "same";
  else if (held(reading)) change = "same";
  const digest = reading.kind === "digest";
  const value = digest || reading.value === null ? change : reading.value;
  const previous = digest ? null : reading.previous;
  const acknowledged = reading.gateAnswer === "mine" || memory.normalForMe[reading.signalId] !== undefined || isMuted(memory, reading.signalId);
  const partial = { signalId: reading.signalId, value, previous, change };
  const gated = GATED_SIGNALS.includes(reading.signalId) && badFlip(partial) && reading.gateAnswer === null && !acknowledged;
  return {
    ...partial,
    severity: SIGNAL_SEVERITY[reading.signalId],
    minutesSinceChange: change === "same" || reading.changedAt === null ? null : minutesBetween(reading.changedAt, now),
    freshness: reading.freshness,
    acknowledged,
    gated,
  };
}

/** The single chokepoint between the probes and the model. Nothing machine-originated survives it. */
export function toWatchContext(input: WatchContextInput): WatchContext {
  const rules = rulesFor(input.report, input.previousReport, input.now);
  const signals = input.readings.map((reading) => signalFor(reading, input.memory, input.now, input.cycle.index === 0));
  const { floor, ceiling } = boundsFor(signals, rules);
  const recent = input.recent.slice(0, WATCH_LIMITS.maxRecent).map((entry) => ({
    signalId: entry.signalId,
    change: entry.change,
    minutesAgo: minutesBetween(entry.at, input.now) ?? 0,
  }));
  return {
    schemaVersion: 1,
    os: input.os,
    osVersion: SAFE_STRING_PATTERN.test(input.osVersion) ? input.osVersion : UNKNOWN_OS_VERSION,
    profile: {
      role: input.profile.role,
      technical: input.profile.technical,
      handlesClientData: input.profile.handlesClientData,
      laptopLeavesHome: input.profile.laptopLeavesHome,
    },
    cycle: {
      index: input.cycle.index,
      minutesSinceFullCheck: input.cycle.minutesSinceFullCheck,
      minutesSinceLastChange: input.cycle.minutesSinceLastChange,
      probesLeft: input.cycle.probesLeft,
    },
    floor,
    ceiling,
    rules,
    signals,
    recent,
    probesAvailable: MODEL_PROBE_IDS,
    actionsAvailable: ACTION_IDS,
    lastVerdict: input.lastVerdict === null ? null : { rating: input.lastVerdict.rating, minutesAgo: input.lastVerdict.minutesAgo },
  };
}
