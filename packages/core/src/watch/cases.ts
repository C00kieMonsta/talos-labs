import type { Finding, RuleId, RuleResult } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import { evaluate } from "../engine/evaluate";
import { toWatchContext, type WatchContextInput } from "../explainer/watch-context";
import { watchRequestBody, type ResponsesRequest } from "../explainer/remote";
import { buildWatchJudgeInstructions } from "../explainer/watch-prompt";
import { DEV_MACHINE } from "../fixtures/dev-machine";
import { HARDENED } from "../fixtures/hardened";
import type { ExplainerProfile } from "../ports/explainer-port";
import type { Change, FishyKind, Rating, SignalId, WatchContext, WatchItem, WatchReport, WatchRule, WatchSignal, WatchState, WatchVerdict } from "../ports/watch-port";
import { ACTION_IDS, MODEL_PROBE_IDS } from "../ports/watch-port";
import { MACOS_CATALOG } from "../rules/macos/index";
import { EMPTY_WATCH_MEMORY } from "./memory";
import { applyHysteresis, boundsFor, rateWatch, topItems } from "./rate";
import { watchReportRow } from "./report-row";
import { GATED_SIGNALS, PAIR_SIGNALS, SIGNAL_KIND, SIGNAL_SEVERITY, STAND_ALONE_SIGNALS, type SignalReading } from "./signals";
import { validateWatchVerdict } from "./validate";
import { WATCH_BANNED_WORDS } from "./words";

/**
 * The parity cases written to packages/core/fixtures/watch-cases.json. The contexts and raw
 * verdicts are hand-written; every expected value is computed by the TypeScript functions so the
 * Rust mirrors (tests/watch_cases_contract.rs) are pinned to this file, not to a second opinion.
 */

export const NOW = "2026-10-17T12:00:00.000Z";
const SCANNED_AT = "2026-10-17T11:30:00.000Z";

const PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };

/** FISHY.noticed.headline in apps/desktop/src/guided/copy.ts; copy.test.ts keeps the two equal. */
export const WATCH_HEADLINES: Readonly<Record<FishyKind, string>> = {
  persistence: "A new program started running on its own",
  listener: "A new program is waiting for calls from the network",
  guard: "A built-in safety guard was switched off",
  remote: "Remote access to your Mac was turned on",
  admin: "A new admin account was added",
  dns: "The way your Mac finds websites changed",
  backup: "Your backups were switched off",
};

/** FISHY.notifyTail; the notification body is the headline, a full stop, a space, then this. */
export const WATCH_NOTIFY_TAIL = "Open me to see what experts suggest.";

/** WATCH.calm, look, lookOne, lookMany and act in copy.ts; the tray tooltip in Rust carries the same words. */
export const WATCH_STATUS_WORDS = {
  calm: "Nothing changed",
  look: "Something to look at",
  lookOne: "One thing to look at",
  lookMany: "{n} things to look at",
  act: "Act now",
} as const;

function minutesBefore(minutes: number): string {
  return new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
}

function minutesAfter(minutes: number): string {
  return minutesBefore(-minutes);
}

function sig(signalId: SignalId, over: Partial<WatchSignal> = {}): WatchSignal {
  return {
    signalId,
    value: false,
    previous: null,
    severity: SIGNAL_SEVERITY[signalId],
    change: "same",
    minutesSinceChange: null,
    freshness: "fresh",
    acknowledged: false,
    gated: false,
    ...over,
  };
}

/** A signal that changed `minutes` ago. */
function changed(signalId: SignalId, value: boolean | number | Change, previous: boolean | number | null, minutes = 30, over: Partial<WatchSignal> = {}): WatchSignal {
  return sig(signalId, { value, previous, change: "changed", minutesSinceChange: minutes, ...over });
}

/** A signal that just became unreadable. */
function unavailable(signalId: SignalId): WatchSignal {
  return sig(signalId, { value: "changed", change: "changed", minutesSinceChange: 0, freshness: "unavailable" });
}

interface ContextOptions {
  readonly rules?: readonly WatchRule[];
  readonly cycleIndex?: number;
  readonly floor?: Rating;
  readonly ceiling?: Rating;
  readonly lastVerdict?: WatchContext["lastVerdict"];
}

function ctx(signals: readonly WatchSignal[], options: ContextOptions = {}): WatchContext {
  const rules = options.rules ?? [];
  const bounds = boundsFor(signals, rules);
  return {
    schemaVersion: 1,
    os: "macos",
    osVersion: "27.0.1",
    profile: PROFILE,
    cycle: { index: options.cycleIndex ?? 3, minutesSinceFullCheck: 90, minutesSinceLastChange: 30, probesLeft: 3 },
    floor: options.floor ?? bounds.floor,
    ceiling: options.ceiling ?? bounds.ceiling,
    rules,
    signals,
    recent: [],
    probesAvailable: MODEL_PROBE_IDS,
    actionsAvailable: ACTION_IDS,
    lastVerdict: options.lastVerdict ?? null,
  };
}

function rule(ruleId: RuleId, change: WatchRule["change"]): WatchRule {
  return { ruleId, status: change === "fixed" ? "pass" : change === "unreadable" ? "unknown" : "fail", severity: "high", change, minutesSinceChange: change === "none" ? null : 30 };
}

function verdict(rating: Rating, over: Partial<WatchVerdict> = {}): WatchVerdict {
  return { rating, ratingReason: "", basedOn: [], probes: [], actions: [], ...over };
}

export interface RateCase {
  readonly name: string;
  readonly context: WatchContext;
  readonly verdict: WatchVerdict | null;
  readonly previousRating: Rating;
  readonly calmStreak: number;
  readonly expectedBounds: { readonly floor: Rating; readonly ceiling: Rating };
  readonly expectedItems: readonly SignalId[];
  /** rateWatch alone. */
  readonly expectedRaw: Rating;
  /** After applyHysteresis(previousRating, expectedRaw, calmStreak). */
  readonly expected: Rating;
  readonly expectedCalmStreak: number;
}

function rateCase(name: string, context: WatchContext, verdict: WatchVerdict | null, previousRating: Rating = "calm", calmStreak = 0): RateCase {
  const expectedRaw = rateWatch(context, verdict);
  const after = applyHysteresis(previousRating, expectedRaw, calmStreak);
  return {
    name,
    context,
    verdict,
    previousRating,
    calmStreak,
    expectedBounds: boundsFor(context.signals, context.rules),
    expectedItems: topItems(context.signals).map((item) => item.signalId),
    expectedRaw,
    expected: after.rating,
    expectedCalmStreak: after.calmStreak,
  };
}

const QUIET: readonly WatchSignal[] = [
  sig("sig.persistence_set", { value: "same" }),
  sig("sig.firewall", { value: true, previous: true }),
  sig("sig.sip", { value: true, previous: true }),
  sig("sig.admin_count", { value: 1, previous: 1 }),
  sig("sig.load_avg", { value: 2, previous: 2 }),
];

const PAIR: readonly WatchSignal[] = [changed("sig.persistence_new", 1, 0), changed("sig.listener_new_ports", 1, 0, 45)];

export const RATE_CASES: readonly RateCase[] = [
  // calm
  rateCase("calm: no signals", ctx([]), null),
  rateCase("calm: every signal the same", ctx(QUIET), null),
  rateCase("calm: an acknowledged change", ctx([...QUIET, changed("sig.persistence_new", 1, 0, 30, { acknowledged: true })]), null),
  rateCase("calm: the model says act_now against a calm ceiling", ctx(QUIET), verdict("act_now")),
  rateCase("calm: a low change older than a day", ctx([...QUIET, changed("sig.established_count", 9, 4, 2000)]), null),
  rateCase("calm: info metrics changed", ctx([...QUIET, changed("sig.load_avg", 6, 2), changed("sig.on_battery", true, false)]), null),
  rateCase("calm: a new item older than a day", ctx([...QUIET, changed("sig.persistence_new", 1, 0, 1500)]), null),
  rateCase("calm: a resolver change, a connection count and the backup age are context only", ctx([...QUIET, changed("sig.resolvers", "changed", null), changed("sig.established_count", 9, 4), changed("sig.backup_age_days", 3, 1)]), null),
  rateCase("calm: still unavailable since the last check", ctx([...QUIET, sig("sig.listener_set", { value: "same", freshness: "unavailable" })]), null),
  rateCase("calm: a rule fixed", ctx(QUIET, { rules: [rule("TL-MAC-002", "fixed"), rule("TL-MAC-001", "none")] }), null),
  rateCase("calm: falls after two calm cycles", ctx(QUIET), null, "keep_an_eye", 1),
  rateCase("calm: the first cycle rates nothing", ctx([...QUIET, changed("sig.sip", false, true)], { cycleIndex: 0 }), verdict("act_now")),
  // keep an eye
  rateCase("look: a lone unsigned item", ctx([...QUIET, changed("sig.persistence_unsigned", 1, 0)]), null),
  rateCase("look: a lone dot-folder item", ctx([...QUIET, changed("sig.persistence_in_temp_or_hidden", 1, 0)]), null),
  rateCase("look: a lone unsigned item in a temp folder raises all three counters from one listing", ctx([...QUIET, changed("sig.persistence_new", 1, 0), changed("sig.persistence_unsigned", 1, 0), changed("sig.persistence_in_temp_or_hidden", 1, 0)]), null),
  rateCase("look: one new agent changes four signals and is one item", ctx([...QUIET.filter((s) => s.signalId !== "sig.persistence_set"), changed("sig.persistence_set", "changed", null), changed("sig.persistence_new", 1, 0), changed("sig.persistence_unsigned", 1, 0), changed("sig.persistence_in_temp_or_hidden", 1, 0)]), null),
  rateCase("look: a removed launch item and a closed listener change the digests and make no item", ctx([...QUIET.filter((s) => s.signalId !== "sig.persistence_set"), changed("sig.persistence_set", "changed", null), changed("sig.listener_set", "changed", null)]), null),
  rateCase("look: an unanswered gate", ctx([...QUIET, changed("sig.remote_access_on", true, false, 10, { gated: true })]), null),
  rateCase("look: a medium change", ctx([...QUIET, changed("sig.share_count", 2, 1)]), null),
  rateCase("look: a rule appeared", ctx(QUIET, { rules: [rule("TL-MAC-004", "appeared")] }), null),
  rateCase("look: the model says calm but the floor holds", ctx([...QUIET, changed("sig.persistence_unsigned", 1, 0)]), verdict("calm")),
  rateCase("look: the model says act_now but the ceiling holds", ctx([...QUIET, changed("sig.share_count", 2, 1)]), verdict("act_now")),
  rateCase("look: act_now falls to look after two lower cycles", ctx([...QUIET, changed("sig.share_count", 2, 1)]), null, "act_now", 1),
  rateCase("look: the firewall became unreadable", ctx([...QUIET.filter((s) => s.signalId !== "sig.firewall"), unavailable("sig.firewall")]), null),
  rateCase("look: the listener set became unreadable", ctx([...QUIET, unavailable("sig.listener_set")]), null),
  rateCase("look: the backup age became unreadable", ctx([...QUIET, unavailable("sig.backup_age_days")]), null),
  rateCase("look: the load average became unreadable", ctx([...QUIET.filter((s) => s.signalId !== "sig.load_avg"), unavailable("sig.load_avg")]), null),
  rateCase("look: act_now with no item is capped", ctx([changed("sig.pending_updates", 3, 1)], { floor: "act_now", ceiling: "act_now" }), verdict("act_now")),
  rateCase("look: the firewall came on, a good flip with no headline", ctx([...QUIET.filter((s) => s.signalId !== "sig.firewall"), changed("sig.firewall", true, false)]), null),
  rateCase("look: backups came back on, a good flip with no headline", ctx([...QUIET, changed("sig.backup_auto", true, false)]), null),
  rateCase("look: the XProtect Remediator version went up, an update with no headline", ctx([...QUIET, changed("sig.xprotect_remediator_version", 150, 149)]), null),
  rateCase("look: a share was removed and Lockdown Mode came on, good flips with no headline", ctx([...QUIET, changed("sig.share_count", 1, 2), changed("sig.lockdown_mode", true, false)]), null),
  // act now
  rateCase("act: SIP went off", ctx([...QUIET.filter((s) => s.signalId !== "sig.sip"), changed("sig.sip", false, true)]), null),
  rateCase("act: Gatekeeper went off", ctx([...QUIET, changed("sig.gatekeeper", false, true)]), null),
  rateCase("act: XProtect went missing", ctx([...QUIET, changed("sig.xprotect_present", false, true)]), null),
  rateCase("act: XProtect scans went off", ctx([...QUIET, changed("sig.xprotect_scans_enabled", false, true)]), null),
  rateCase("act: the XProtect version went down", ctx([...QUIET, changed("sig.xprotect_version", 5300, 5311)]), null),
  rateCase("act: a hidden account appeared", ctx([...QUIET, changed("sig.hidden_user_count", 1, 0)]), null),
  rateCase("act: a new item and a new listener", ctx([...QUIET, ...PAIR]), null),
  rateCase("act: an unsigned temp item and a manual DNS server", ctx([...QUIET, changed("sig.persistence_new", 1, 0), changed("sig.persistence_unsigned", 1, 0), changed("sig.persistence_in_temp_or_hidden", 1, 0), changed("sig.dns_manual", true, false, 20)]), null),
  rateCase("act: manual DNS and a PAC URL", ctx([...QUIET, changed("sig.dns_manual", true, false), changed("sig.pac_url_set", true, false, 5)]), null),
  rateCase("act: a profile and a system extension", ctx([...QUIET, changed("sig.profiles_count", 1, 0), changed("sig.sysext_count", 2, 1, 120)]), null),
  rateCase("act: a login key and a cron line", ctx([...QUIET, changed("sig.authorized_keys_changed", true, false), changed("sig.cron_lines", 1, 0, 600)]), null),
  rateCase("act: an unsigned item corroborates an unanswered gate", ctx([...QUIET.filter((s) => s.signalId !== "sig.firewall"), changed("sig.firewall", false, true, 10, { gated: true }), changed("sig.persistence_unsigned", 1, 0)]), null),
  rateCase("act: a gate answered No", ctx([...QUIET, changed("sig.remote_access_on", true, false, 10)]), null),
  rateCase("act: the model agrees within the bounds", ctx([...QUIET, ...PAIR]), verdict("act_now", { basedOn: ["sig.persistence_new"] })),
  rateCase("act: rises at once from calm", ctx([...QUIET, ...PAIR]), null, "calm", 0),
  rateCase("act: holds on the first lower cycle", ctx([...QUIET, changed("sig.share_count", 2, 1)]), null, "act_now", 0),
];

export interface ValidateCase {
  readonly name: string;
  readonly context: WatchContext;
  readonly raw: unknown;
  readonly expected: "rejected" | WatchVerdict;
}

const ACT_CONTEXT = ctx([...QUIET, ...PAIR]);
const LOOK_CONTEXT = ctx([...QUIET, changed("sig.share_count", 2, 1)]);

const GOOD = {
  rating: "act_now",
  ratingReason: "Two things changed within the hour.",
  basedOn: ["sig.persistence_new", "sig.listener_new_ports"],
  probes: [{ probeId: "probe.persistence", reason: "Read the start-up list again." }],
  actions: [{ actionId: "act.disconnect_network", sentence: "Cut the Mac off first." }],
};

function validateCase(name: string, context: WatchContext, raw: unknown): ValidateCase {
  const result = validateWatchVerdict(raw, context);
  return { name, context, raw, expected: result.ok ? result.value : "rejected" };
}

const VERBS = ["pid", "process", "kill", "delete", "remove", "rm", "unload"] as const;

export const VALIDATE_CASES: readonly ValidateCase[] = [
  validateCase("kept: a full verdict", ACT_CONTEXT, GOOD),
  validateCase("rejected: not an object", ACT_CONTEXT, "act_now"),
  validateCase("rejected: rating outside the enum", ACT_CONTEXT, { ...GOOD, rating: "panic" }),
  validateCase("rejected: reason not a string", ACT_CONTEXT, { ...GOOD, ratingReason: 5 }),
  validateCase("rejected: unknown signal id", ACT_CONTEXT, { ...GOOD, basedOn: ["sig.nope"] }),
  validateCase("rejected: a signal not in the context", ACT_CONTEXT, { ...GOOD, basedOn: ["sig.sysext_count"] }),
  validateCase("rejected: duplicate signal id", ACT_CONTEXT, { ...GOOD, basedOn: ["sig.persistence_new", "sig.persistence_new"] }),
  validateCase("rejected: basedOn over the cap", ACT_CONTEXT, { ...GOOD, basedOn: Array.from({ length: 7 }, () => "sig.persistence_new") }),
  validateCase("rejected: unknown probe id", ACT_CONTEXT, { ...GOOD, probes: [{ probeId: "probe.nope", reason: "" }] }),
  validateCase("rejected: a Rust-only probe", ACT_CONTEXT, { ...GOOD, probes: [{ probeId: "probe.persistence_signatures", reason: "" }] }),
  validateCase("rejected: the other Rust-only probe", ACT_CONTEXT, { ...GOOD, probes: [{ probeId: "probe.ssh_keys", reason: "" }] }),
  validateCase("rejected: duplicate probe", ACT_CONTEXT, { ...GOOD, probes: [{ probeId: "probe.firewall", reason: "" }, { probeId: "probe.firewall", reason: "" }] }),
  validateCase("rejected: probes over the cap", ACT_CONTEXT, { ...GOOD, probes: ["probe.firewall", "probe.hosts", "probe.backup", "probe.updates"].map((probeId) => ({ probeId, reason: "" })) }),
  validateCase("rejected: a probe that is not an object", ACT_CONTEXT, { ...GOOD, probes: ["probe.firewall"] }),
  validateCase("rejected: unknown action id", ACT_CONTEXT, { ...GOOD, actions: [{ actionId: "act.nope", sentence: "" }] }),
  validateCase("rejected: duplicate action", ACT_CONTEXT, { ...GOOD, actions: [{ actionId: "act.report", sentence: "" }, { actionId: "act.report", sentence: "" }] }),
  validateCase("rejected: actions over the cap", ACT_CONTEXT, { ...GOOD, actions: ["act.report", "act.get_help", "act.do_not_wait", "act.change_passwords"].map((actionId) => ({ actionId, sentence: "" })) }),
  validateCase("rejected: an action sentence that is not a string", ACT_CONTEXT, { ...GOOD, actions: [{ actionId: "act.report", sentence: null }] }),
  validateCase("clamped: rating above the ceiling", LOOK_CONTEXT, { ...GOOD, rating: "act_now", basedOn: ["sig.share_count"], actions: [] }),
  validateCase("clamped: rating below the floor", ACT_CONTEXT, { ...GOOD, rating: "calm" }),
  validateCase("dropped: command text in the reason", ACT_CONTEXT, { ...GOOD, ratingReason: "Run this:\n```\nls\n```" }),
  validateCase("dropped: a path in the reason", ACT_CONTEXT, { ...GOOD, ratingReason: "Look under /usr/local/bin for it." }),
  validateCase("dropped: a port in the reason", ACT_CONTEXT, { ...GOOD, ratingReason: "Something listens on :8080 now." }),
  validateCase("dropped: a reason over 120 characters", ACT_CONTEXT, { ...GOOD, ratingReason: "a".repeat(121) }),
  validateCase("kept: a reason of exactly 120 characters", ACT_CONTEXT, { ...GOOD, ratingReason: "a".repeat(120) }),
  validateCase("dropped: an action sentence over 300 characters stays dropped, a 200-character one is kept", ACT_CONTEXT, {
    ...GOOD,
    actions: [
      { actionId: "act.disconnect_network", sentence: "a".repeat(301) },
      { actionId: "act.block_incoming", sentence: "a".repeat(200) },
    ],
  }),
  validateCase("dropped: a path in a probe reason", ACT_CONTEXT, { ...GOOD, probes: [{ probeId: "probe.hosts", reason: "Check ~/.zshrc too." }] }),
  ...VERBS.map((verb) => validateCase(`dropped: the verb ${verb} in an action sentence`, ACT_CONTEXT, { ...GOOD, actions: [{ actionId: "act.disconnect_network", sentence: `You should ${verb} it now.` }] })),
  validateCase("dropped: an action whose floor is above the clamped rating", LOOK_CONTEXT, { ...GOOD, rating: "keep_an_eye", basedOn: ["sig.share_count"], actions: [{ actionId: "act.disconnect_network", sentence: "" }] }),
  validateCase("dropped: an action with no changed trigger", ACT_CONTEXT, { ...GOOD, actions: [{ actionId: "act.turn_on_firewall", sentence: "" }] }),
  validateCase("kept: a relevant look action", LOOK_CONTEXT, { rating: "keep_an_eye", ratingReason: "", basedOn: ["sig.share_count"], probes: [], actions: [{ actionId: "act.stop_guest_sharing", sentence: "Close the share you do not use." }] }),
];

export interface ContextCase {
  readonly name: string;
  readonly input: WatchContextInput;
  readonly expected: WatchContext;
}

function reading(signalId: SignalId, over: Partial<SignalReading> = {}): SignalReading {
  return {
    signalId,
    kind: "bool",
    value: false,
    previous: false,
    change: "same",
    changedAt: null,
    freshness: "fresh",
    previousFreshness: "fresh",
    gateAnswer: null,
    ...over,
  };
}

const PREVIOUS_REPORT = evaluate(HARDENED, MACOS_CATALOG, { now: "2026-10-16T11:30:00.000Z", os: "macos" });
const REPORT = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: SCANNED_AT, os: "macos" });

/** 110 result rows: 90 unique, 10 duplicates and 10 malformed ids; the join keeps the first 64 unique ones. */
function hundredRowReport(): ScanReport {
  const template = REPORT.results[0];
  const finding = REPORT.findings[0];
  if (template === undefined || finding === undefined) throw new Error("the dev-machine report is empty");
  const results: RuleResult[] = [];
  const findings: Finding[] = [];
  for (let i = 1; i <= 90; i += 1) {
    const ruleId = `TL-MAC-R${String(i).padStart(3, "0")}` as RuleId;
    results.push({ ...template, ruleId, status: i % 7 === 0 ? "unknown" : i % 3 === 0 ? "pass" : "fail", evidence: [], unknownReason: i % 7 === 0 ? "indeterminate" : null, points: 0 });
    if (i % 2 === 0) findings.push({ ...finding, ruleId, severity: i % 4 === 0 ? "high" : "low", evidence: [] });
  }
  for (let i = 1; i <= 10; i += 1) {
    const ruleId = `TL-MAC-R${String(i).padStart(3, "0")}` as RuleId;
    results.splice(i * 5, 0, { ...template, ruleId, status: "fail", evidence: [], unknownReason: null, points: 0 });
  }
  for (const bad of ["bad", "TL-MAC-", "TL-IOS-001", "tl-mac-001", "TL-MAC-00 1", "TL-MAC-001/x", "", "TL-MAC-001 ", "TL-MAC-öö", "TLMAC001"]) {
    results.push({ ...template, ruleId: bad as RuleId, status: "fail", evidence: [], unknownReason: null, points: 0 });
  }
  return { ...REPORT, results, findings };
}

function contextCase(name: string, input: WatchContextInput): ContextCase {
  return { name, input, expected: toWatchContext(input) };
}

const FIRST_CYCLE_READINGS: readonly SignalReading[] = [
  reading("sig.persistence_set", { kind: "digest", value: null, previous: null, change: "first_seen" }),
  reading("sig.firewall", { value: false, previous: null, change: "first_seen" }),
  reading("sig.sip", { value: true, previous: null, change: "first_seen" }),
  reading("sig.admin_count", { kind: "count", value: 1, previous: null, change: "first_seen" }),
  reading("sig.xprotect_version", { kind: "version", value: 5311, previous: null, change: "first_seen" }),
];

const SECOND_CYCLE_READINGS: readonly SignalReading[] = [
  reading("sig.persistence_set", { kind: "digest", value: null, previous: null, change: "changed", changedAt: minutesBefore(20) }),
  reading("sig.persistence_new", { kind: "count", value: 1, previous: 0, change: "changed", changedAt: minutesBefore(20), hasStartupEntry: true, codesignValid: false }),
  reading("sig.firewall", { value: false, previous: true, change: "changed", changedAt: minutesBefore(15) }),
  reading("sig.remote_access_on", { value: true, previous: false, change: "changed", changedAt: minutesBefore(200), gateAnswer: "mine" }),
  reading("sig.guest_share", { value: true, previous: false, change: "changed", changedAt: minutesBefore(50), gateAnswer: "not_mine" }),
  reading("sig.listener_set", { kind: "digest", value: null, previous: null, change: "same", freshness: "unavailable", previousFreshness: "fresh" }),
  reading("sig.established_count", { kind: "count", value: null, previous: 4, change: "same", freshness: "unavailable", previousFreshness: "unavailable" }),
  reading("sig.gatekeeper", { value: true, previous: false, change: "changed", changedAt: minutesBefore(8), fixedByTalosAt: minutesBefore(9) }),
  reading("sig.share_count", { kind: "count", value: 2, previous: 1, change: "changed", changedAt: minutesBefore(40) }),
  reading("sig.hosts_changed", { value: true, previous: false, change: "changed", changedAt: minutesBefore(100) }),
  reading("sig.sip", { value: true, previous: true }),
  reading("sig.xprotect_version", { kind: "version", value: 5312, previous: 5311, change: "changed", changedAt: minutesBefore(300) }),
  reading("sig.admin_count", { kind: "count", value: 2, previous: 1, change: "changed", changedAt: minutesBefore(1500) }),
  reading("sig.resolvers", { kind: "digest", value: null, previous: null, change: "changed", changedAt: "not a date" }),
  reading("sig.on_battery", { value: true, previous: false, change: "changed", changedAt: minutesBefore(3) }),
];

const RECENT = Array.from({ length: 25 }, (_, i) => ({
  signalId: (["sig.persistence_set", "sig.firewall", "sig.share_count"] as const)[i % 3] as SignalId,
  change: (i % 5 === 0 ? "cleared" : "changed") as Change,
  at: minutesBefore(i * 7),
}));

export const CONTEXT_CASES: readonly ContextCase[] = [
  contextCase("first cycle: no previous report, every reading first seen", {
    previousReport: null,
    report: REPORT,
    readings: FIRST_CYCLE_READINGS,
    memory: EMPTY_WATCH_MEMORY,
    recent: [],
    now: NOW,
    os: "macos",
    osVersion: "27.0.1",
    profile: PROFILE,
    cycle: { index: 0, minutesSinceFullCheck: 0, minutesSinceLastChange: null, probesLeft: 3 },
    lastVerdict: null,
  }),
  contextCase("second cycle: hardened to dev machine, gates, holds, memory and an unavailable probe", {
    previousReport: PREVIOUS_REPORT,
    report: REPORT,
    readings: SECOND_CYCLE_READINGS,
    memory: { ...EMPTY_WATCH_MEMORY, normalForMe: { "sig.share_count": minutesBefore(60) }, acknowledgeCount: { "sig.hosts_changed": 3, "sig.firewall": 1 } },
    recent: RECENT,
    now: NOW,
    os: "macos",
    osVersion: "27.0.1 (build 26A434)",
    profile: { role: "freelancer", technical: "medium", handlesClientData: true, laptopLeavesHome: false },
    cycle: { index: 2, minutesSinceFullCheck: 45, minutesSinceLastChange: 3, probesLeft: 1 },
    lastVerdict: { rating: "keep_an_eye", minutesAgo: 60 },
  }),
  contextCase("100 report rows: the join keeps the first 64 unique ids", {
    previousReport: null,
    report: hundredRowReport(),
    readings: [reading("sig.sip", { value: true, previous: true })],
    memory: EMPTY_WATCH_MEMORY,
    recent: [],
    now: NOW,
    os: "macos",
    osVersion: "27.0.1",
    profile: PROFILE,
    cycle: { index: 5, minutesSinceFullCheck: 10, minutesSinceLastChange: null, probesLeft: 0 },
    lastVerdict: null,
  }),
  contextCase("a report with another schema version carries no rules", {
    previousReport: null,
    report: { ...REPORT, schemaVersion: 2 } as unknown as ScanReport,
    readings: [reading("sig.sip", { value: true, previous: true })],
    memory: EMPTY_WATCH_MEMORY,
    recent: [],
    now: NOW,
    os: "macos",
    osVersion: "27.0.1",
    profile: PROFILE,
    cycle: { index: 1, minutesSinceFullCheck: 10, minutesSinceLastChange: null, probesLeft: 3 },
    lastVerdict: null,
  }),
];

export interface ChatgptBodyCase {
  readonly model: string;
  readonly instructions: string;
  readonly context: WatchContext;
  readonly body: ResponsesRequest;
}

const BODY_CONTEXT = CONTEXT_CASES[1]?.expected ?? ctx([]);

export const CHATGPT_BODY_CASE: ChatgptBodyCase = {
  model: "gpt-test",
  instructions: buildWatchJudgeInstructions(),
  context: BODY_CONTEXT,
  body: watchRequestBody("gpt-test", buildWatchJudgeInstructions(), BODY_CONTEXT),
};

export interface WindowSentenceCase {
  readonly name: string;
  readonly text: string;
  readonly rating: Rating;
  /** Hand-written; window-sentence.test.ts asserts safeWindowSentence agrees. */
  readonly kept: boolean;
}

/** A sentence of exactly 121 characters: one over the window cap, dropped and never cut. */
export const LONG_WINDOW_SENTENCE = `${"a".repeat(120)}.`;

/** The window line cases of docs/DESIGN-WATCH-WINDOW.md section 7; Rust pins safe_window_sentence to them. */
export const WINDOW_SENTENCE_CASES: readonly WindowSentenceCase[] = [
  { name: "kept: what is open and why, under 120 characters", text: "The one thing still open is the update you have been putting off, and it closes the hole attackers try first.", rating: "calm", kept: true },
  { name: "kept: a clock time is not a port", text: "It comes back at 18:00.", rating: "calm", kept: true },
  { name: "kept: and/or is not a path", text: "Nothing here is and/or stuck.", rating: "calm", kept: true },
  { name: "kept: malware alone is allowed", text: "A new start-up program is how malware usually stays on a Mac.", rating: "keep_an_eye", kept: true },
  { name: "kept: a duration on keep_an_eye", text: "Three days without a change.", rating: "keep_an_eye", kept: true },
  { name: "dropped: a duration on calm", text: "Three days without a change.", rating: "calm", kept: false },
  { name: "dropped: the app's voice", text: "I'll keep an eye on it for you.", rating: "calm", kept: false },
  { name: "dropped: a reassurance word", text: "Your Mac is safe for now.", rating: "calm", kept: false },
  { name: "dropped: no malware", text: "There is no malware here.", rating: "calm", kept: false },
  { name: "dropped: an action claim", text: "Done, the firewall is back on.", rating: "keep_an_eye", kept: false },
  { name: "dropped: an imperative start", text: "Turn the firewall on first.", rating: "keep_an_eye", kept: false },
  { name: "dropped: a banned word", text: "A new rule appeared.", rating: "keep_an_eye", kept: false },
  { name: "dropped: a path", text: "~/Library/LaunchAgents changed.", rating: "keep_an_eye", kept: false },
  { name: "dropped: a port", text: "port :8080 opened.", rating: "keep_an_eye", kept: false },
  { name: "dropped: a 121-character sentence", text: LONG_WINDOW_SENTENCE, rating: "keep_an_eye", kept: false },
  { name: "dropped: two sentences", text: "Two things changed. One of them is new.", rating: "keep_an_eye", kept: false },
  { name: "dropped: empty", text: "", rating: "calm", kept: false },
];

export interface HeightCase {
  readonly name: string;
  readonly state: WatchState;
  /** Hand-computed from the sum rule of docs/DESIGN-WATCH-WINDOW.md contract F. */
  readonly height: number;
}

/** The judge lines the demo shows; each passes safeWindowSentence for its rating (pinned in the tests). */
export const DEMO_REASONS: Readonly<Record<Rating, string>> = {
  calm: "The one thing still open is your unlocked disk, and it matters most on a laptop that leaves the house.",
  keep_an_eye: "Two start-up changes in a day is more than this Mac usually sees.",
  act_now: "A new start-up program and a new open port appeared within the same hour.",
};

const DEMO_REPORT_ID = "demo-report";
const DEMO_REPORT: WatchReport = { reportId: DEMO_REPORT_ID, scannedAt: minutesBefore(120), score: 72, grade: "fair" };
const DEMO_NEXT: WatchState["next"] = { reportId: DEMO_REPORT_ID, ruleId: "TL-MAC-001", kind: "fix" };
const DEMO_AI: WatchState["ai"] = { enabled: true, provider: "chatgpt" };

function judge(rating: Rating): WatchState["judge"] {
  return { provider: "chatgpt", at: minutesBefore(12), rating, reason: DEMO_REASONS[rating] };
}

function item(signalId: SignalId, kind: FishyKind, over: Partial<WatchItem> = {}): WatchItem {
  const severity = SIGNAL_SEVERITY[signalId];
  return {
    signalId,
    kind,
    severity,
    points: { critical: 10, high: 6, medium: 3, low: 1, info: 0 }[severity],
    change: "changed",
    changedAt: minutesBefore(30),
    gated: false,
    snoozedUntil: null,
    hasStartupEntry: false,
    isListener: false,
    actionIds: [],
    modelSentence: null,
    modelProvider: null,
    ...over,
  };
}

const LOOK_ITEMS: readonly WatchItem[] = [item("sig.persistence_new", "persistence", { hasStartupEntry: true })];
const ACT_ITEMS: readonly WatchItem[] = [
  item("sig.persistence_new", "persistence", { hasStartupEntry: true }),
  item("sig.listener_new_ports", "listener", { isListener: true }),
  item("sig.cron_lines", "persistence"),
];

/** The three socket-table probes an unsigned build cannot read. */
const UNREADABLE: WatchState["unavailable"] = [
  { probeId: "probe.listeners", reason: "unsigned_build" },
  { probeId: "probe.remote_access", reason: "unsigned_build" },
  { probeId: "probe.file_sharing", reason: "unsigned_build" },
];
const UNREADABLE_ONE: WatchState["unavailable"] = [{ probeId: "probe.listeners", reason: "unsigned_build" }];

/** A full calm WatchState on the demo machine; every key present so Rust's serde and the window's parser see whole states. */
export function baseState(over: Partial<WatchState> = {}): WatchState {
  return {
    enabled: true,
    licensed: true,
    firstRun: false,
    hiddenLaunch: false,
    rating: "calm",
    since: minutesBefore(3 * 24 * 60),
    lastCheckAt: minutesBefore(12),
    checking: false,
    cycleIndex: 7,
    everyMinutes: 60,
    notify: true,
    pausedUntil: null,
    closeWatchUntil: null,
    unavailable: [],
    gated: [],
    items: [],
    nextCheckAt: minutesAfter(48),
    lastChangeAt: minutesBefore(3 * 24 * 60),
    ai: DEMO_AI,
    judge: null,
    recentCount: 0,
    rulesSince: null,
    report: DEMO_REPORT,
    next: DEMO_NEXT,
    ...over,
  };
}

function heightCase(name: string, height: number, over: Partial<WatchState>): HeightCase {
  return { name, state: baseState(over), height };
}

/** The sixteen named states of contract F; the heights are written by hand from the sum rule. */
export const HEIGHT_CASES: readonly HeightCase[] = [
  heightCase("first-run", 170, { firstRun: true, since: null, lastCheckAt: null, cycleIndex: 0, nextCheckAt: null, lastChangeAt: null, report: null, next: null }),
  heightCase("paused", 152, { pausedUntil: minutesAfter(60) }),
  heightCase("calm-reason", 332, { judge: judge("calm") }),
  heightCase("calm", 280, {}),
  heightCase("calm-unreadable", 400, { judge: judge("calm"), unavailable: UNREADABLE }),
  heightCase("calm-not-connected", 288, { ai: { enabled: false, provider: null } }),
  heightCase("calm-no-ai", 228, { ai: { enabled: false, provider: "chatgpt" } }),
  heightCase("calm-no-report", 252, { report: null, next: null }),
  heightCase("look-reason", 396, { rating: "keep_an_eye", since: minutesBefore(30), items: LOOK_ITEMS, recentCount: 1, lastChangeAt: minutesBefore(30), judge: judge("keep_an_eye") }),
  heightCase("look-reason-no-link", 356, { rating: "keep_an_eye", since: minutesBefore(30), items: LOOK_ITEMS, recentCount: 1, lastChangeAt: minutesBefore(30), judge: judge("keep_an_eye"), ai: { enabled: false, provider: "chatgpt" } }),
  heightCase("look", 316, { rating: "keep_an_eye", since: minutesBefore(30), items: LOOK_ITEMS, recentCount: 1, lastChangeAt: minutesBefore(30) }),
  heightCase("look-plain", 276, { rating: "keep_an_eye", since: minutesBefore(30), items: LOOK_ITEMS, recentCount: 1, lastChangeAt: minutesBefore(30), ai: { enabled: false, provider: "chatgpt" } }),
  heightCase("look-empty", 324, { rating: "keep_an_eye", since: minutesBefore(30), recentCount: 1, rulesSince: { reportId: DEMO_REPORT_ID, appeared: 1 }, judge: judge("keep_an_eye") }),
  heightCase("act-reason", 404, { rating: "act_now", since: minutesBefore(30), items: ACT_ITEMS, recentCount: 3, lastChangeAt: minutesBefore(30), judge: judge("act_now") }),
  heightCase("act", 324, { rating: "act_now", since: minutesBefore(30), items: ACT_ITEMS, recentCount: 3, lastChangeAt: minutesBefore(30) }),
  heightCase("act-reason-unreadable", 420, { rating: "act_now", since: minutesBefore(30), items: ACT_ITEMS, recentCount: 3, lastChangeAt: minutesBefore(30), judge: judge("act_now"), unavailable: UNREADABLE_ONE }),
];

export interface ReportRowCase {
  readonly name: string;
  readonly report: unknown;
  readonly row: WatchReport | null;
}

function reportRowCase(name: string, report: unknown): ReportRowCase {
  return { name, report, row: watchReportRow(report) };
}

/** A real evaluate() report with the id and score the cases need; the nested score shape is the engine's. */
const ROW_REPORT: ScanReport = { ...REPORT, reportId: "r-1", score: { ...REPORT.score, value: 72, grade: "fair" } };

/** The last-report.json shapes Rust context::report_row and watchReportRow must read alike. */
export const REPORT_ROW_CASES: readonly ReportRowCase[] = [
  reportRowCase("a real report gives the flat row", ROW_REPORT),
  reportRowCase("a null score value and grade give null fields", { ...ROW_REPORT, score: { ...ROW_REPORT.score, value: null, grade: null } }),
  reportRowCase("a bare number for score nulls the fields, not the row", { ...ROW_REPORT, score: 72 }),
  reportRowCase("a score value over 100 is null", { ...ROW_REPORT, score: { ...ROW_REPORT.score, value: 101 } }),
  reportRowCase("a grade outside the four words is null", { ...ROW_REPORT, score: { ...ROW_REPORT.score, grade: "great" } }),
  reportRowCase("a report id with a space and a bang is no row", { ...ROW_REPORT, reportId: "bad id!" }),
  reportRowCase("a report id of 65 characters is no row", { ...ROW_REPORT, reportId: "r".repeat(65) }),
  reportRowCase("a scannedAt that does not parse is no row", { ...ROW_REPORT, scannedAt: "yesterday" }),
  reportRowCase("no report id is no row", (({ reportId: _dropped, ...rest }) => rest)(ROW_REPORT)),
];

export interface WatchCases {
  readonly signalSeverity: typeof SIGNAL_SEVERITY;
  readonly signalKind: typeof SIGNAL_KIND;
  readonly gated: readonly SignalId[];
  readonly standAlone: readonly SignalId[];
  readonly pairSet: readonly SignalId[];
  readonly headlines: Readonly<Record<FishyKind, string>>;
  readonly notifyTail: string;
  readonly statusWords: typeof WATCH_STATUS_WORDS;
  readonly rate: readonly RateCase[];
  readonly validate: readonly ValidateCase[];
  readonly contexts: readonly ContextCase[];
  readonly chatgptBody: ChatgptBodyCase;
  readonly bannedWords: readonly string[];
  readonly windowSentences: readonly WindowSentenceCase[];
  readonly heights: readonly HeightCase[];
  readonly reportRows: readonly ReportRowCase[];
}

export const WATCH_CASES: WatchCases = {
  signalSeverity: SIGNAL_SEVERITY,
  signalKind: SIGNAL_KIND,
  gated: GATED_SIGNALS,
  standAlone: STAND_ALONE_SIGNALS,
  pairSet: PAIR_SIGNALS,
  headlines: WATCH_HEADLINES,
  notifyTail: WATCH_NOTIFY_TAIL,
  statusWords: WATCH_STATUS_WORDS,
  rate: RATE_CASES,
  validate: VALIDATE_CASES,
  contexts: CONTEXT_CASES,
  chatgptBody: CHATGPT_BODY_CASE,
  bannedWords: WATCH_BANNED_WORDS,
  windowSentences: WINDOW_SENTENCE_CASES,
  heights: HEIGHT_CASES,
  reportRows: REPORT_ROW_CASES,
};

/** The JSON written to packages/core/fixtures/watch-cases.json. Keys stay in declaration order. */
export function watchCasesJson(): string {
  return `${JSON.stringify(WATCH_CASES, null, 2)}\n`;
}
