import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type {
  ActionId,
  Change,
  ExplainerProfile,
  FishyKind,
  FixApplyOptions,
  FixChoice,
  FixOutcome,
  FixPlanLine,
  Grade,
  ModelProbeId,
  ProbeId,
  Rating,
  RuleChange,
  RuleId,
  RuleStatus,
  Severity,
  SignalId,
  UnavailableProbe,
  WatchContext,
  WatchDetails,
  WatchDetailsItem,
  WatchDetailsScope,
  WatchInterval,
  WatchItem,
  WatchAi,
  WatchJudge,
  WatchModelProvider,
  WatchNext,
  WatchOpenEvent,
  WatchOpenScreen,
  WatchPlan,
  WatchReport,
  WatchRulesSince,
  WatchUnavailableReason,
  WatchPort,
  WatchRule,
  WatchSignal,
  WatchState,
  WatchActionId,
  WatchLastVerdict,
} from "@talos/core";
import {
  ACTION_IDS,
  FISHY_KINDS,
  MACOS_CATALOG,
  MODEL_PROBE_IDS,
  NEXT_KINDS,
  PROBE_IDS,
  RATING_ORDER,
  SAFE_STRING_PATTERN,
  SIGNAL_IDS,
  WATCH_ACTION_IDS,
  WATCH_GRADES,
  WATCH_INTERVALS,
  WATCH_LIMITS,
  WATCH_OPEN_SCREENS,
  WATCH_REPORT_ID,
  WATCH_RULE_ID,
  WATCH_UNAVAILABLE_REASONS,
} from "@talos/core";
import type { InvokeFn } from "./apple-explainer";
import { rejectionToOutcome, toFixOutcome, toFixProgress } from "./tauri-fix";

/**
 * WatchPort over the Tauri commands (docs/DESIGN-WATCH.md section 8). Rust owns the cycle, the
 * baselines and every path; the webview sends ids, booleans, numbers and the profile object, and
 * shape-checks everything that comes back. Errors are the Rust snake_case strings, like tauri-fix.
 */

export type WatchListenFn = (event: string, handler: (payload: unknown) => void) => Promise<() => void>;

export interface TauriWatchOptions {
  readonly invoke?: InvokeFn;
  readonly listen?: WatchListenFn;
  /** The watch window: only status, checkNow, pause and openMain work; the rest reject with forbidden_window. */
  readonly limited?: boolean;
}

export const FORBIDDEN_WINDOW = "forbidden_window";

const CHANGES: readonly Change[] = ["same", "changed", "first_seen", "appeared", "cleared"];
const FRESHNESS = ["fresh", "stale", "unavailable"] as const;
const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low", "info"];
const RULE_STATUSES: readonly RuleStatus[] = ["pass", "fail", "review", "unknown", "not_applicable"];
const RULE_CHANGES: readonly RuleChange[] = ["none", "appeared", "fixed", "unreadable"];
const OSES = ["macos", "windows", "linux"] as const;
const ROLES = ["individual", "freelancer", "small_business"] as const;
const TECHNICAL = ["low", "medium", "high"] as const;
const SCOPES: readonly WatchDetailsScope[] = ["user_agent", "system_agent", "system_daemon"];
const PROVIDERS: readonly WatchModelProvider[] = ["apple", "chatgpt", "claude_plan"];
/** Longest free-text detail accepted; a listing entry past this is a sign of something wrong, not a path. */
const MAX_DETAIL_CHARS = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isIsoOrNull(value: unknown): value is string | null {
  return value === null || isIso(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCountOrNull(value: unknown): value is number | null {
  return value === null || isCount(value);
}

/** An action-row sentence: at most 300 characters. */
function isSentence(value: unknown): value is string {
  return typeof value === "string" && value.length <= WATCH_LIMITS.maxSentenceChars;
}

/** The judge's window line: 1 to 120 characters, already through safe_window_sentence in Rust. */
function isReason(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= WATCH_LIMITS.maxReasonChars;
}

function isReportId(value: unknown): value is string {
  return typeof value === "string" && WATCH_REPORT_ID.test(value);
}

function isRuleId(value: unknown): value is RuleId {
  return typeof value === "string" && WATCH_RULE_ID.test(value);
}

/** Only an id the catalogue knows may reach guidedFor; Rust stores what rule_id_ok accepts. */
function inCatalog(ruleId: RuleId): boolean {
  return MACOS_CATALOG.rules.some((rule) => rule.id === ruleId);
}

function isSignalId(value: unknown): value is SignalId {
  return oneOf(value, SIGNAL_IDS);
}

function isActionId(value: unknown): value is ActionId {
  return oneOf(value, ACTION_IDS);
}

function isWatchActionId(value: unknown): value is WatchActionId {
  return oneOf(value, WATCH_ACTION_IDS);
}

function allOf<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(check);
}

function toUnavailable(value: unknown): UnavailableProbe | null {
  if (!isRecord(value)) return null;
  const { probeId, reason } = value;
  if (!oneOf(probeId, PROBE_IDS) || !oneOf(reason, WATCH_UNAVAILABLE_REASONS)) return null;
  return { probeId: probeId as ProbeId, reason: reason as WatchUnavailableReason };
}

export function toWatchItem(value: unknown): WatchItem | null {
  if (!isRecord(value)) return null;
  const { signalId, kind, severity, points, change, changedAt, gated, snoozedUntil, hasStartupEntry, isListener, actionIds, modelSentence, modelProvider } = value;
  if (!isSignalId(signalId) || !oneOf(kind, FISHY_KINDS) || !oneOf(severity, SEVERITIES)) return null;
  if (!isCount(points) || !oneOf(change, CHANGES) || !isIsoOrNull(changedAt)) return null;
  if (typeof gated !== "boolean" || !isIsoOrNull(snoozedUntil)) return null;
  if (typeof hasStartupEntry !== "boolean" || typeof isListener !== "boolean") return null;
  if (!allOf(actionIds, isActionId)) return null;
  if (modelSentence !== null && !isSentence(modelSentence)) return null;
  if (modelProvider !== null && !oneOf(modelProvider, PROVIDERS)) return null;
  return {
    signalId,
    kind: kind as FishyKind,
    severity: severity as Severity,
    points,
    change: change as Change,
    changedAt,
    gated,
    snoozedUntil,
    hasStartupEntry,
    isListener,
    actionIds,
    modelSentence: modelSentence as string | null,
    modelProvider: modelProvider as WatchModelProvider | null,
  };
}

function toAi(value: unknown): WatchAi | null {
  if (!isRecord(value) || typeof value["enabled"] !== "boolean") return null;
  const provider = value["provider"];
  if (provider !== null && !oneOf(provider, PROVIDERS)) return null;
  return { enabled: value["enabled"], provider: provider as WatchModelProvider | null };
}

/** The judge's line: null on absence or any malformation, never failing the state. */
export function toJudge(value: unknown): WatchJudge | null {
  if (!isRecord(value)) return null;
  const { provider, at, rating, reason } = value;
  if (!oneOf(provider, PROVIDERS) || !isIso(at) || !oneOf(rating, RATING_ORDER) || !isReason(reason)) return null;
  return { provider: provider as WatchModelProvider, at, rating: rating as Rating, reason };
}

export function toRulesSince(value: unknown): WatchRulesSince | null {
  if (!isRecord(value)) return null;
  const { reportId, appeared } = value;
  if (!isReportId(reportId) || !isCount(appeared)) return null;
  return { reportId, appeared };
}

/** The check-up row; mirrors watchReportRow for a row that already crossed the wire flat. */
export function toReport(value: unknown): WatchReport | null {
  if (!isRecord(value)) return null;
  const { reportId, scannedAt, score, grade } = value;
  if (!isReportId(reportId) || !isIso(scannedAt)) return null;
  if (score !== null && (!isCount(score) || score > 100)) return null;
  if (grade !== null && !oneOf(grade, WATCH_GRADES)) return null;
  return { reportId, scannedAt, score: score as number | null, grade: grade as Grade | null };
}

/** The plan's next step; an id outside the catalogue reads as null so the window never names it. */
export function toNext(value: unknown): WatchNext | null {
  if (!isRecord(value)) return null;
  const { reportId, ruleId, kind } = value;
  if (!isReportId(reportId) || !isRuleId(ruleId) || !oneOf(kind, NEXT_KINDS) || !inCatalog(ruleId)) return null;
  return { reportId, ruleId, kind };
}

/** Every field checked; a malformed state is dropped rather than shown. The four optional rows read null on malformation instead. */
export function toWatchState(value: unknown): WatchState | null {
  if (!isRecord(value)) return null;
  const { enabled, licensed, firstRun, hiddenLaunch, rating, since, lastCheckAt, checking, cycleIndex, everyMinutes, notify, pausedUntil, closeWatchUntil, unavailable, gated, items } = value;
  const { nextCheckAt, lastChangeAt, recentCount } = value;
  if (typeof enabled !== "boolean" || typeof licensed !== "boolean" || typeof firstRun !== "boolean" || typeof hiddenLaunch !== "boolean" || typeof checking !== "boolean" || typeof notify !== "boolean") return null;
  if (!oneOf(rating, RATING_ORDER)) return null;
  if (!isIsoOrNull(since) || !isIsoOrNull(lastCheckAt) || !isIsoOrNull(pausedUntil) || !isIsoOrNull(closeWatchUntil)) return null;
  if (!isCount(cycleIndex)) return null;
  if (!isIsoOrNull(nextCheckAt) || !isIsoOrNull(lastChangeAt) || !isCount(recentCount)) return null;
  const ai = toAi(value["ai"]);
  if (ai === null) return null;
  if (typeof everyMinutes !== "number" || !(WATCH_INTERVALS as readonly number[]).includes(everyMinutes)) return null;
  if (!Array.isArray(unavailable) || !Array.isArray(items) || !allOf(gated, isSignalId)) return null;
  const parsedUnavailable: UnavailableProbe[] = [];
  for (const row of unavailable) {
    const parsed = toUnavailable(row);
    if (parsed === null) return null;
    parsedUnavailable.push(parsed);
  }
  const parsedItems: WatchItem[] = [];
  for (const row of items) {
    const parsed = toWatchItem(row);
    if (parsed === null) return null;
    parsedItems.push(parsed);
  }
  return {
    enabled,
    licensed,
    firstRun,
    hiddenLaunch,
    rating: rating as Rating,
    since,
    lastCheckAt,
    checking,
    cycleIndex,
    everyMinutes: everyMinutes as WatchInterval,
    notify,
    pausedUntil,
    closeWatchUntil,
    unavailable: parsedUnavailable,
    gated,
    items: parsedItems,
    nextCheckAt,
    lastChangeAt,
    ai,
    judge: toJudge(value["judge"]),
    recentCount,
    rulesSince: toRulesSince(value["rulesSince"]),
    report: toReport(value["report"]),
    next: toNext(value["next"]),
  };
}

function toProfile(value: unknown): ExplainerProfile | null {
  if (!isRecord(value)) return null;
  const { role, technical, handlesClientData, laptopLeavesHome } = value;
  if (!oneOf(role, ROLES) || !oneOf(technical, TECHNICAL)) return null;
  if (typeof handlesClientData !== "boolean" || typeof laptopLeavesHome !== "boolean") return null;
  return { role, technical, handlesClientData, laptopLeavesHome };
}

function toSignal(value: unknown): WatchSignal | null {
  if (!isRecord(value)) return null;
  const { signalId, value: reading, previous, severity, change, minutesSinceChange, freshness, acknowledged, gated } = value;
  if (!isSignalId(signalId) || !oneOf(severity, SEVERITIES) || !oneOf(change, CHANGES) || !oneOf(freshness, FRESHNESS)) return null;
  if (typeof reading !== "boolean" && typeof reading !== "number" && !oneOf(reading, CHANGES)) return null;
  if (previous !== null && typeof previous !== "boolean" && typeof previous !== "number") return null;
  if (!isCountOrNull(minutesSinceChange) || typeof acknowledged !== "boolean" || typeof gated !== "boolean") return null;
  return { signalId, value: reading as boolean | number | Change, previous, severity: severity as Severity, change: change as Change, minutesSinceChange, freshness, acknowledged, gated };
}

function toRule(value: unknown): WatchRule | null {
  if (!isRecord(value)) return null;
  const { ruleId, status, severity, change, minutesSinceChange } = value;
  if (typeof ruleId !== "string" || !WATCH_RULE_ID.test(ruleId)) return null;
  if (!oneOf(status, RULE_STATUSES) || !oneOf(severity, SEVERITIES) || !oneOf(change, RULE_CHANGES) || !isCountOrNull(minutesSinceChange)) return null;
  return { ruleId: ruleId as RuleId, status: status as RuleStatus, severity: severity as Severity, change: change as RuleChange, minutesSinceChange };
}

function toRecent(value: unknown): WatchContext["recent"][number] | null {
  if (!isRecord(value)) return null;
  const { signalId, change, minutesAgo } = value;
  if (!isSignalId(signalId) || !oneOf(change, CHANGES) || !isCount(minutesAgo)) return null;
  return { signalId, change: change as Change, minutesAgo };
}

function toLastVerdict(value: unknown): WatchLastVerdict | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !oneOf(value["rating"], RATING_ORDER) || !isCount(value["minutesAgo"])) return undefined;
  return { rating: value["rating"] as Rating, minutesAgo: value["minutesAgo"] as number };
}

function mapAll<T>(value: unknown, parse: (item: unknown) => T | null, max: number): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

/** The model's document: closed enums, counts and booleans only, every id checked and every list capped. */
export function toWatchContext(value: unknown): WatchContext | null {
  if (!isRecord(value) || value["schemaVersion"] !== 1) return null;
  const { os, osVersion, cycle, floor, ceiling, lastVerdict } = value;
  if (!oneOf(os, OSES) || typeof osVersion !== "string" || !SAFE_STRING_PATTERN.test(osVersion)) return null;
  const profile = toProfile(value["profile"]);
  if (profile === null) return null;
  if (!isRecord(cycle) || !isCount(cycle["index"]) || !isCount(cycle["minutesSinceFullCheck"]) || !isCountOrNull(cycle["minutesSinceLastChange"]) || !isCount(cycle["probesLeft"])) return null;
  if (!oneOf(floor, RATING_ORDER) || !oneOf(ceiling, RATING_ORDER)) return null;
  const rules = mapAll(value["rules"], toRule, WATCH_LIMITS.maxRules);
  if (rules === null || new Set(rules.map((r) => r.ruleId)).size !== rules.length) return null;
  const signals = mapAll(value["signals"], toSignal, SIGNAL_IDS.length);
  if (signals === null) return null;
  const recent = mapAll(value["recent"], toRecent, WATCH_LIMITS.maxRecent);
  if (recent === null) return null;
  const probesAvailable = value["probesAvailable"];
  const actionsAvailable = value["actionsAvailable"];
  if (!allOf(probesAvailable, (id): id is ModelProbeId => oneOf(id, MODEL_PROBE_IDS)) || !allOf(actionsAvailable, isActionId)) return null;
  const verdict = toLastVerdict(lastVerdict);
  if (verdict === undefined) return null;
  return {
    schemaVersion: 1,
    os,
    osVersion,
    profile,
    cycle: {
      index: cycle["index"] as number,
      minutesSinceFullCheck: cycle["minutesSinceFullCheck"] as number,
      minutesSinceLastChange: cycle["minutesSinceLastChange"] as number | null,
      probesLeft: cycle["probesLeft"] as number,
    },
    floor: floor as Rating,
    ceiling: ceiling as Rating,
    rules,
    signals,
    recent,
    probesAvailable,
    actionsAvailable,
    lastVerdict: verdict,
  };
}

function optionalText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= MAX_DETAIL_CHARS);
}

function toDetailsItem(value: unknown): WatchDetailsItem | null {
  if (!isRecord(value)) return null;
  const { signalId, plistPath, label, programPath, scope, port, processName } = value;
  if (!isSignalId(signalId)) return null;
  if (!optionalText(plistPath) || !optionalText(label) || !optionalText(programPath) || !optionalText(processName)) return null;
  if (scope !== undefined && !oneOf(scope, SCOPES)) return null;
  if (port !== undefined && (!isCount(port) || port > 65535)) return null;
  const item: { -readonly [K in keyof WatchDetailsItem]: WatchDetailsItem[K] } = { signalId };
  if (plistPath !== undefined) item.plistPath = plistPath;
  if (label !== undefined) item.label = label;
  if (programPath !== undefined) item.programPath = programPath;
  if (scope !== undefined) item.scope = scope;
  if (port !== undefined) item.port = port;
  if (processName !== undefined) item.processName = processName;
  return item;
}

/** The one document with machine text. wifiAvailable is required: a missing flag is a malformed reply. */
export function toWatchDetails(value: unknown): WatchDetails | null {
  if (!isRecord(value) || typeof value["wifiAvailable"] !== "boolean") return null;
  const items = mapAll(value["items"], toDetailsItem, 256);
  if (items === null) return null;
  return { items, wifiAvailable: value["wifiAvailable"] };
}

function toLine(value: unknown): FixPlanLine | null {
  if (!isRecord(value)) return null;
  const { text, privilege } = value;
  if (typeof text !== "string" || (privilege !== "user" && privilege !== "admin")) return null;
  return { text, privilege };
}

/** The FixPlan wire with ruleId set to a watch.* id; anything outside WATCH_ACTION_IDS is refused. */
export function toWatchPlan(value: unknown): WatchPlan | null {
  if (!isRecord(value)) return null;
  const { planId, ruleId, lines, needsPassword, reversible, expiresAt } = value;
  if (typeof planId !== "string" || planId.length === 0 || planId.length > 128) return null;
  if (!isWatchActionId(ruleId)) return null;
  const parsedLines = mapAll(lines, toLine, 64);
  if (parsedLines === null || parsedLines.length === 0) return null;
  if (typeof needsPassword !== "boolean") return null;
  if (reversible !== null && typeof reversible !== "string") return null;
  if (!isIso(expiresAt)) return null;
  return { planId, actionId: ruleId, lines: parsedLines, needsPassword, reversible, expiresAt };
}

function validChoice(choice: FixChoice): boolean {
  if (choice.kind === "none") return true;
  if (choice.kind !== "plist") return false;
  return typeof choice.path === "string" && choice.path.length > 0 && choice.path.length <= MAX_DETAIL_CHARS;
}

function requireSignal(signalId: SignalId): void {
  if (!isSignalId(signalId)) throw "invalid_input";
}

/** The four fields the Rust mirror accepts, and nothing else from the settings object. */
/** The most accepted ids one push carries; Rust's `MAX_ACCEPTED`. */
const MAX_ACCEPTED = 64;

/** Well-formed rule ids only, first occurrence kept, at most MAX_ACCEPTED. */
function acceptedOnTheWire(accepted: readonly RuleId[]): string[] {
  const clean: string[] = [];
  for (const id of accepted) {
    if (typeof id !== "string" || !WATCH_RULE_ID.test(id) || clean.includes(id)) continue;
    clean.push(id);
  }
  return clean.slice(0, MAX_ACCEPTED);
}

function profileOnTheWire(profile: ExplainerProfile): ExplainerProfile {
  return { role: profile.role, technical: profile.technical, handlesClientData: profile.handlesClientData, laptopLeavesHome: profile.laptopLeavesHome };
}

/** `{ kind: "none" }` for null, else the three ids checked; Rust's clean_next refuses the rest. */
function nextOnTheWire(next: WatchNext | null): { readonly kind: string; readonly reportId?: string; readonly ruleId?: string } {
  if (next === null) return { kind: "none" };
  if (!isReportId(next.reportId) || !isRuleId(next.ruleId) || !oneOf(next.kind, NEXT_KINDS)) throw "invalid_input";
  return { kind: next.kind, reportId: next.reportId, ruleId: next.ruleId };
}

/**
 * The person's own words, as the main window's composer takes them: CR and LF become spaces,
 * every other Unicode control (C0, DEL and C1, the set Rust's `char::is_control` refuses) is
 * stripped, the ends are trimmed. Never logged, never persisted.
 */
export function cleanQuestion(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\r\n]+/g, " ").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();
}

export class TauriWatchAdapter implements WatchPort {
  private readonly invoke: InvokeFn;
  private readonly listen: WatchListenFn;
  private readonly limited: boolean;

  constructor(options: TauriWatchOptions = {}) {
    this.invoke = options.invoke ?? ((cmd, args) => tauriInvoke<unknown>(cmd, args));
    this.listen = options.listen ?? (async (event, handler) => tauriListen<unknown>(event, (e) => handler(e.payload)));
    this.limited = options.limited === true;
  }

  private full(): void {
    if (this.limited) throw FORBIDDEN_WINDOW;
  }

  private subscribe<T>(event: string, parse: (payload: unknown) => T | null, listener: (value: T) => void): () => void {
    let live = true;
    const pending = this.listen(event, (payload) => {
      if (!live) return;
      const parsed = parse(payload);
      if (parsed !== null) listener(parsed);
    }).catch((): (() => void) => () => undefined);
    return () => {
      live = false;
      void pending.then((unlisten) => unlisten());
    };
  }

  async status(): Promise<WatchState> {
    const state = toWatchState(await this.invoke("watch_status", {}));
    if (state === null) throw "command_failed";
    return state;
  }

  async checkNow(): Promise<void> {
    await this.invoke("watch_check_now", {});
  }

  async pause(minutes: 60): Promise<void> {
    if (minutes !== 60) throw "invalid_input";
    await this.invoke("watch_pause", { minutes });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.full();
    await this.invoke("watch_set_enabled", { enabled: enabled === true });
  }

  async setInterval(minutes: WatchInterval): Promise<void> {
    this.full();
    if (!(WATCH_INTERVALS as readonly number[]).includes(minutes)) throw "invalid_input";
    await this.invoke("watch_set_interval", { minutes });
  }

  async setNotify(enabled: boolean): Promise<void> {
    this.full();
    await this.invoke("watch_set_notify", { enabled: enabled === true });
  }

  async requestNotifyPermission(): Promise<void> {
    this.full();
    await this.invoke("watch_request_notify_permission", {});
  }

  /** `licensed` is the webview's product gate; Rust persists it and never verifies a key. */
  async setProfile(profile: ExplainerProfile, ai: WatchAi | undefined, licensed: boolean, accepted?: readonly RuleId[], next?: WatchNext | null): Promise<void> {
    this.full();
    const clean = toProfile(profileOnTheWire(profile));
    if (clean === null) throw "invalid_input";
    // `accepted` and `next` cross only when the caller gave them: Rust keeps its stored values otherwise.
    const extra = { ...(accepted === undefined ? {} : { accepted: acceptedOnTheWire(accepted) }), ...(next === undefined ? {} : { next: nextOnTheWire(next) }) };
    if (ai === undefined) {
      await this.invoke("watch_set_profile", { profile: clean, licensed: licensed === true, ...extra });
      return;
    }
    const provider = ai.provider !== null && oneOf(ai.provider, PROVIDERS) ? ai.provider : null;
    await this.invoke("watch_set_profile", { profile: clean, ai: { enabled: ai.enabled === true, provider }, licensed: licensed === true, ...extra });
  }

  async acknowledge(signalId: SignalId): Promise<void> {
    this.full();
    requireSignal(signalId);
    await this.invoke("watch_acknowledge", { signal: signalId });
  }

  async answerGate(signalId: SignalId, mine: boolean): Promise<void> {
    this.full();
    requireSignal(signalId);
    await this.invoke("watch_answer_gate", { signal: signalId, mine: mine === true });
  }

  async snooze(signalId: SignalId): Promise<void> {
    this.full();
    requireSignal(signalId);
    await this.invoke("watch_snooze", { signal: signalId });
  }

  async context(): Promise<WatchContext> {
    this.full();
    const context = toWatchContext(await this.invoke("watch_context", {}));
    if (context === null) throw "command_failed";
    return context;
  }

  async details(): Promise<WatchDetails> {
    this.full();
    const details = toWatchDetails(await this.invoke("watch_details", {}));
    if (details === null) throw "command_failed";
    return details;
  }

  /** The question is accepted with "chat" only, cleaned, at most 500 UTF-16 units; an empty one sends the screen alone. */
  async openMain(screen: WatchOpenScreen, question?: string): Promise<void> {
    if (!oneOf(screen, WATCH_OPEN_SCREENS)) throw "invalid_input";
    if (question === undefined) {
      await this.invoke("watch_open_main", { screen });
      return;
    }
    if (typeof question !== "string" || screen !== "chat") throw "invalid_input";
    const clean = cleanQuestion(question);
    if (clean.length > WATCH_LIMITS.maxQuestionChars) throw "invalid_input";
    if (clean.length === 0) {
      await this.invoke("watch_open_main", { screen });
      return;
    }
    await this.invoke("watch_open_main", { screen, question: clean });
  }

  async openSource(actionId: ActionId): Promise<void> {
    this.full();
    if (!isActionId(actionId)) throw "invalid_input";
    await this.invoke("watch_open_source", { action: actionId });
  }

  async actionPreview(actionId: WatchActionId, choice: FixChoice): Promise<WatchPlan> {
    this.full();
    if (!isWatchActionId(actionId)) throw "not_in_catalog";
    if (!validChoice(choice)) throw "invalid_choice";
    const plan = toWatchPlan(await this.invoke("watch_action_preview", { action: actionId, choice }));
    if (plan === null) throw "command_failed";
    return plan;
  }

  /** Like TauriFixAdapter.apply: fix:status carries progress, fix_cancel answers an abort. */
  async actionApply(planId: string, options?: FixApplyOptions): Promise<FixOutcome> {
    if (this.limited) return { ok: false, error: "command_failed", step: null };
    const signal = options?.signal;
    if (signal?.aborted) return { ok: false, error: "cancelled", step: null };
    let unlisten: (() => void) | null = null;
    const onAbort = () => {
      void this.invoke("fix_cancel", { plan: planId }).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort);
    try {
      unlisten = await this.listen("fix:status", (payload) => {
        const progress = toFixProgress(payload);
        if (progress !== null && progress.planId === planId) options?.onProgress?.(progress);
      });
      return toFixOutcome(await this.invoke("watch_action_apply", { plan: planId }));
    } catch (error) {
      return rejectionToOutcome(error);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unlisten?.();
    }
  }

  async autostartEnable(): Promise<void> {
    this.full();
    await this.invoke("autostart_enable", {});
  }

  async autostartDisable(): Promise<void> {
    this.full();
    await this.invoke("autostart_disable", {});
  }

  async autostartIsEnabled(): Promise<boolean> {
    this.full();
    return (await this.invoke("autostart_is_enabled", {})) === true;
  }

  onState(listener: (state: WatchState) => void): () => void {
    return this.subscribe("watch:state", toWatchState, listener);
  }

  onNotified(listener: (event: { readonly signalId: SignalId }) => void): () => void {
    if (this.limited) return () => undefined;
    return this.subscribe(
      "watch:notified",
      (payload) => (isRecord(payload) && isSignalId(payload["signalId"]) ? { signalId: payload["signalId"] } : null),
      listener,
    );
  }

  onOpen(listener: (event: WatchOpenEvent) => void): () => void {
    if (this.limited) return () => undefined;
    return this.subscribe("watch:open", toOpenEvent, listener);
  }

  onShown(listener: (event: WatchOpenEvent) => void): () => void {
    if (this.limited) return () => undefined;
    return this.subscribe("main:shown", toOpenEvent, listener);
  }
}

/** `{ screen }` or `{ screen, question }`; a question that is not a string or is over 500 units drops the payload. */
export function toOpenEvent(payload: unknown): WatchOpenEvent | null {
  if (!isRecord(payload) || !oneOf(payload["screen"], WATCH_OPEN_SCREENS)) return null;
  const screen = payload["screen"];
  if (!("question" in payload) || payload["question"] === undefined) return { screen };
  const question = payload["question"];
  if (typeof question !== "string" || question.length > WATCH_LIMITS.maxQuestionChars) return null;
  return { screen, question };
}
