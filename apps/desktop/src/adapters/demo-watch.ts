import type {
  ActionId,
  ExplainerProfile,
  FishyKind,
  FixApplyOptions,
  FixChoice,
  FixOutcome,
  FixPlanLine,
  Rating,
  RuleId,
  SignalId,
  WatchActionId,
  WatchAi,
  WatchContext,
  WatchDetails,
  WatchDetailsItem,
  WatchInterval,
  WatchItem,
  WatchModelProvider,
  WatchOpenScreen,
  WatchPlan,
  WatchPort,
  WatchSignal,
  WatchState,
} from "@talos/core";
import { ACTION_IDS, boundsFor, MODEL_PROBE_IDS, PLAYBOOK, RATING_ORDER, rateWatch, SIGNAL_POINTS, SIGNAL_SEVERITY, topItems, WATCH_ACTION_IDS, WATCH_INTERVALS } from "@talos/core";
import type { WatchDemoFlags } from "../app/demo-boot";
import { recordDemoCall, wait } from "./demo-shared";

/**
 * The browser-only watch (docs/DESIGN-WATCH.md section 8, demo params). Serves one state built
 * from the URL flags, mutates it the way Rust would on each call, and records every call kind.
 * Nothing here reads the Mac; the "paths" below are fixture text for the Details disclosure.
 */

export const DEMO_WATCH_PLAN_TTL_MS = 5 * 60_000;
export const DEFAULT_WATCH_DELAY_MS = 400;
const DAY_MS = 86_400_000;
const SNOOZE_DAYS = 14;

const NEUTRAL_PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };

/** Why the three socket-table probes read unavailable on an ad-hoc build. */
const UNREADABLE_PROBES: WatchState["unavailable"] = [
  { probeId: "probe.listeners", reason: "permission_denied" },
  { probeId: "probe.remote_access", reason: "permission_denied" },
  { probeId: "probe.file_sharing", reason: "permission_denied" },
];

interface DemoSignal {
  readonly signalId: SignalId;
  readonly value: boolean | number;
  readonly previous: boolean | number;
}

/**
 * Per kind: the top signal first, then the one that corroborates it from another listing (the
 * three persistence counters count once). look keeps only the first.
 */
const SIGNAL_SETS: Readonly<Record<FishyKind, readonly DemoSignal[]>> = {
  persistence: [
    { signalId: "sig.persistence_new", value: 1, previous: 0 },
    { signalId: "sig.listener_new_ports", value: 1, previous: 0 },
  ],
  listener: [
    { signalId: "sig.listener_new_ports", value: 1, previous: 0 },
    { signalId: "sig.cron_lines", value: 1, previous: 0 },
  ],
  guard: [
    { signalId: "sig.firewall", value: false, previous: true },
    { signalId: "sig.gatekeeper", value: false, previous: true },
  ],
  remote: [
    { signalId: "sig.remote_access_on", value: true, previous: false },
    { signalId: "sig.share_count", value: 2, previous: 1 },
  ],
  admin: [
    { signalId: "sig.admin_count", value: 2, previous: 1 },
    { signalId: "sig.user_count", value: 3, previous: 2 },
  ],
  dns: [
    { signalId: "sig.dns_manual", value: true, previous: false },
    { signalId: "sig.pac_url_set", value: true, previous: false },
  ],
  backup: [
    { signalId: "sig.backup_auto", value: false, previous: true },
    { signalId: "sig.backup_destinations", value: 0, previous: 1 },
  ],
};

/** Fixture text for Details; never sent anywhere, never an adapter argument. */
const DETAIL_ITEMS: Readonly<Record<FishyKind, WatchDetailsItem>> = {
  persistence: {
    signalId: "sig.persistence_new",
    plistPath: "/Users/demo/Library/LaunchAgents/com.example.helper.plist",
    label: "com.example.helper",
    programPath: "/Users/demo/Library/Application Support/.helper/helper",
    scope: "user_agent",
  },
  listener: { signalId: "sig.listener_new_ports", port: 4444, processName: "helper" },
  guard: { signalId: "sig.firewall" },
  remote: { signalId: "sig.remote_access_on" },
  admin: { signalId: "sig.admin_count" },
  dns: { signalId: "sig.dns_manual" },
  backup: { signalId: "sig.backup_auto" },
};

const MODEL_SENTENCE = "It appeared on its own, and nothing you installed today explains it.";

const PREVIEW_LINES: Readonly<Record<WatchActionId, { readonly lines: readonly FixPlanLine[]; readonly needsPassword: boolean; readonly reversible: string | null }>> = {
  "watch.wifi_off": { lines: [{ text: "/usr/sbin/networksetup -setairportpower en0 off", privilege: "admin" }], needsPassword: true, reversible: "Turn Wi-Fi on from the last screen, or from the menu bar." },
  "watch.wifi_on": { lines: [{ text: "/usr/sbin/networksetup -setairportpower en0 on", privilege: "admin" }], needsPassword: true, reversible: null },
  "watch.block_incoming": { lines: [{ text: "/usr/libexec/ApplicationFirewall/socketfilterfw --setblockall on", privilege: "admin" }], needsPassword: true, reversible: "Allow incoming again from the last screen." },
  "watch.allow_incoming": { lines: [{ text: "/usr/libexec/ApplicationFirewall/socketfilterfw --setblockall off", privilege: "admin" }], needsPassword: true, reversible: null },
  "watch.stop_user_agent": { lines: [{ text: "/bin/launchctl bootout gui/501 {path}", privilege: "user" }], needsPassword: false, reversible: "The file is still there; it starts again at the next login unless you switch it off." },
  "watch.stop_daemon": { lines: [{ text: "/bin/launchctl bootout system {path}", privilege: "admin" }], needsPassword: true, reversible: "The file is still there; it starts again at the next restart unless you switch it off." },
};

function isWatchActionId(value: string): value is WatchActionId {
  return (WATCH_ACTION_IDS as readonly string[]).includes(value);
}

function rank(rating: Rating): number {
  return RATING_ORDER.indexOf(rating);
}

function providerFor(ai: WatchDemoFlags["watchAi"]): WatchModelProvider | null {
  switch (ai) {
    case "apple":
      return "apple";
    case "chatgpt":
      return "chatgpt";
    case "claude":
      return "claude_plan";
    default:
      return null;
  }
}

/** The playbook rows the signal triggers, in catalogue order, at or under the rating. */
function actionIdsFor(signalId: SignalId, rating: Rating): ActionId[] {
  return PLAYBOOK.filter((row) => row.triggers.includes(signalId) && rank(row.floor) <= rank(rating)).map((row) => row.id);
}

function toSignals(set: readonly DemoSignal[], gatedId: SignalId | null): WatchSignal[] {
  return set.map((s) => ({
    signalId: s.signalId,
    value: s.value,
    previous: s.previous,
    severity: SIGNAL_SEVERITY[s.signalId],
    change: "changed",
    minutesSinceChange: 30,
    freshness: "fresh",
    acknowledged: false,
    gated: s.signalId === gatedId,
  }));
}

export class DemoWatch implements WatchPort {
  private state: WatchState;
  private signals: WatchSignal[];
  private profile: ExplainerProfile = NEUTRAL_PROFILE;
  private readonly provider: WatchModelProvider | null;
  private readonly withSentence: boolean;
  private readonly withVerdict: boolean;
  private readonly wifiAvailable: boolean;
  private readonly kind: FishyKind;
  private autostart = false;
  private readonly snoozed = new Map<SignalId, string>();
  private readonly plans = new Map<string, WatchPlan>();
  private counter = 0;
  private readonly stateListeners = new Set<(state: WatchState) => void>();
  private readonly notifiedListeners = new Set<(event: { readonly signalId: SignalId }) => void>();
  private readonly openListeners = new Set<(event: { readonly screen: WatchOpenScreen }) => void>();

  constructor(
    readonly flags: WatchDemoFlags,
    private readonly delayMs = DEFAULT_WATCH_DELAY_MS,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    const watch = flags.watch;
    const withItems = watch === "act" || watch === "look";
    this.kind = flags.fishy ?? "persistence";
    this.provider = providerFor(flags.watchAi);
    this.withSentence = this.provider !== null;
    this.withVerdict = flags.watchAi !== "limit" && flags.watchAi !== "off" && flags.watchAi !== null;
    this.wifiAvailable = !flags.fishyWired;
    // A gated flip waits alone for its answer; act carries the corroborating signal too.
    const set = withItems ? (watch === "act" && !flags.fishyGate ? SIGNAL_SETS[this.kind] : SIGNAL_SETS[this.kind].slice(0, 1)) : [];
    const gatedId = flags.fishyGate && set.length > 0 ? (set[0] as DemoSignal).signalId : null;
    this.signals = toSignals(set, gatedId);
    const at = this.now();
    const rating: Rating = watch === "act" ? "act_now" : watch === "look" ? "keep_an_eye" : "calm";
    const firstRun = watch === "first-run";
    this.state = {
      enabled: true,
      licensed: flags.licensed,
      firstRun,
      hiddenLaunch: false,
      rating,
      since: firstRun ? null : new Date(Date.parse(at) - 30 * 60_000).toISOString(),
      lastCheckAt: firstRun ? null : new Date(Date.parse(at) - 12 * 60_000).toISOString(),
      checking: false,
      cycleIndex: firstRun ? 0 : 4,
      everyMinutes: 60,
      notify: true,
      pausedUntil: null,
      closeWatchUntil: null,
      unavailable: watch === "unreadable" ? UNREADABLE_PROBES : [],
      gated: gatedId === null ? [] : [gatedId],
      items: this.itemsFor(rating, at),
    };
    // Rust emits watch:notified on the transition into act now, and only while the watch is active; the harness asserts the record.
    if (watch === "act" && gatedId === null && flags.licensed) {
      const top = this.state.items[0];
      if (top !== undefined) recordDemoCall({ kind: "watch:notified", arg: top.signalId });
    }
  }

  private itemsFor(rating: Rating, at: string): WatchItem[] {
    const changedAt = new Date(Date.parse(at) - 30 * 60_000).toISOString();
    const items = topItems(this.signals).map((top, index): WatchItem => {
      const signal = this.signals.find((s) => s.signalId === top.signalId);
      return {
        signalId: top.signalId,
        kind: top.kind,
        severity: SIGNAL_SEVERITY[top.signalId],
        points: SIGNAL_POINTS[SIGNAL_SEVERITY[top.signalId]],
        change: "changed",
        changedAt,
        gated: signal?.gated === true,
        snoozedUntil: this.snoozed.get(top.signalId) ?? null,
        hasStartupEntry: top.kind === "persistence",
        isListener: top.kind === "listener",
        actionIds: actionIdsFor(top.signalId, rating),
        modelSentence: this.withSentence && index === 0 ? MODEL_SENTENCE : null,
        modelProvider: this.withSentence && index === 0 ? this.provider : null,
      };
    });
    // Gated and snoozed items sit after the others, as Rust orders them.
    return items.sort((a, b) => Number(a.gated || a.snoozedUntil !== null) - Number(b.gated || b.snoozedUntil !== null));
  }

  /** Act now only while the unsnoozed signals justify it by the rules; "Not now" and a drop cap the rest. */
  private ratingWithoutSnoozed(): Rating {
    if (this.state.rating !== "act_now") return this.state.rating;
    const remaining = this.signals.filter((s) => !this.snoozed.has(s.signalId));
    return rateWatch(this.contextFor(remaining), null) === "act_now" ? "act_now" : "keep_an_eye";
  }

  private set(patch: Partial<WatchState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.stateListeners) listener(this.state);
  }

  /** Drops the signal, like a Rust re-baseline, and re-rates from what is left. */
  private dropSignal(signalId: SignalId): void {
    this.signals = this.signals.filter((s) => s.signalId !== signalId);
    this.snoozed.delete(signalId);
    const items = this.itemsFor(this.state.rating, this.now());
    const rating: Rating = items.length === 0 ? "calm" : this.ratingWithoutSnoozed();
    this.set({ items: items.map((item) => ({ ...item, actionIds: actionIdsFor(item.signalId, rating) })), rating, gated: this.state.gated.filter((id) => id !== signalId) });
  }

  async status(): Promise<WatchState> {
    return this.state;
  }

  async checkNow(): Promise<void> {
    recordDemoCall({ kind: "watch_check_now" });
    this.set({ checking: true });
    await wait(this.delayMs);
    this.set({ checking: false, lastCheckAt: this.now(), cycleIndex: this.state.cycleIndex + 1, firstRun: false });
  }

  async pause(minutes: 60): Promise<void> {
    recordDemoCall({ kind: "watch_pause", arg: minutes });
    this.set({ pausedUntil: new Date(Date.parse(this.now()) + minutes * 60_000).toISOString() });
  }

  async setEnabled(enabled: boolean): Promise<void> {
    recordDemoCall({ kind: "watch_set_enabled", arg: enabled });
    this.set({ enabled });
  }

  async setInterval(minutes: WatchInterval): Promise<void> {
    if (!(WATCH_INTERVALS as readonly number[]).includes(minutes)) throw "invalid_input";
    recordDemoCall({ kind: "watch_set_interval", arg: minutes });
    this.set({ everyMinutes: minutes });
  }

  async setNotify(enabled: boolean): Promise<void> {
    recordDemoCall({ kind: "watch_set_notify", arg: enabled });
    this.set({ notify: enabled });
  }

  async requestNotifyPermission(): Promise<void> {
    recordDemoCall({ kind: "watch_request_notify_permission" });
  }

  /** A false push settles the state as Rust does (calm, no items); a true push flips the flag and leaves the rest alone. The accepted ids are taken and never recorded, like Rust. */
  async setProfile(profile: ExplainerProfile, _ai: WatchAi | undefined, licensed: boolean, _accepted?: readonly RuleId[]): Promise<void> {
    recordDemoCall({ kind: "watch_set_profile", arg: licensed });
    this.profile = { role: profile.role, technical: profile.technical, handlesClientData: profile.handlesClientData, laptopLeavesHome: profile.laptopLeavesHome };
    if (licensed) {
      this.state = { ...this.state, licensed: true };
      return;
    }
    this.set({ licensed: false, rating: "calm", items: [], gated: [], unavailable: [] });
  }

  async acknowledge(signalId: SignalId): Promise<void> {
    recordDemoCall({ kind: "watch_acknowledge", arg: signalId });
    this.dropSignal(signalId);
  }

  async answerGate(signalId: SignalId, mine: boolean): Promise<void> {
    recordDemoCall({ kind: "watch_answer_gate", arg: signalId, prompt: mine ? "mine" : "not_mine" });
    if (mine) {
      this.dropSignal(signalId);
      return;
    }
    this.signals = this.signals.map((s) => (s.signalId === signalId ? { ...s, gated: false } : s));
    this.set({ gated: this.state.gated.filter((id) => id !== signalId), rating: "act_now", items: this.itemsFor("act_now", this.now()) });
  }

  /** "Not now": the item is capped at keep_an_eye for 14 days and no act-now state survives it. */
  async snooze(signalId: SignalId): Promise<void> {
    recordDemoCall({ kind: "watch_snooze", arg: signalId });
    const until = new Date(Date.parse(this.now()) + SNOOZE_DAYS * DAY_MS).toISOString();
    this.snoozed.set(signalId, until);
    const rating = this.ratingWithoutSnoozed();
    this.set({ items: this.itemsFor(rating, this.now()), rating });
  }

  private contextFor(signals: readonly WatchSignal[]): WatchContext {
    const bounds = boundsFor(signals);
    return {
      schemaVersion: 1,
      os: "macos",
      osVersion: "27.0.1",
      profile: this.profile,
      cycle: { index: this.state.cycleIndex, minutesSinceFullCheck: 90, minutesSinceLastChange: signals.length > 0 ? 30 : null, probesLeft: 3 },
      floor: bounds.floor,
      ceiling: bounds.ceiling,
      rules: [],
      signals,
      recent: signals.map((s) => ({ signalId: s.signalId, change: s.change, minutesAgo: 30 })),
      probesAvailable: MODEL_PROBE_IDS,
      actionsAvailable: ACTION_IDS,
      lastVerdict: this.withVerdict && signals.length > 0 ? { rating: this.state.rating, minutesAgo: 12 } : null,
    };
  }

  async context(): Promise<WatchContext> {
    return this.contextFor(this.signals);
  }

  async details(): Promise<WatchDetails> {
    const items = this.state.items.map((item): WatchDetailsItem => (item.signalId === DETAIL_ITEMS[item.kind].signalId ? DETAIL_ITEMS[item.kind] : { signalId: item.signalId }));
    return { items, wifiAvailable: this.wifiAvailable };
  }

  async openMain(screen: WatchOpenScreen): Promise<void> {
    for (const listener of this.openListeners) listener({ screen });
  }

  async openSource(actionId: ActionId): Promise<void> {
    if (!(ACTION_IDS as readonly string[]).includes(actionId)) throw "invalid_input";
    // The id only: the URL stays in the PLAYBOOK table and is never recorded.
    recordDemoCall({ kind: "watch_open_source", arg: actionId });
  }

  async actionPreview(actionId: WatchActionId, choice: FixChoice): Promise<WatchPlan> {
    recordDemoCall({ kind: "watch_action_preview", arg: actionId });
    if (!isWatchActionId(actionId)) throw "not_in_catalog";
    const needsPlist = actionId === "watch.stop_user_agent" || actionId === "watch.stop_daemon";
    if (needsPlist ? choice.kind !== "plist" : choice.kind !== "none") throw "invalid_choice";
    const path = choice.kind === "plist" ? choice.path : "";
    const spec = PREVIEW_LINES[actionId];
    this.counter += 1;
    const plan: WatchPlan = {
      planId: `demo-watch-${this.counter}`,
      actionId,
      lines: spec.lines.map((line) => ({ text: line.text.split("{path}").join(path), privilege: line.privilege })),
      needsPassword: spec.needsPassword,
      reversible: spec.reversible,
      expiresAt: new Date(Date.parse(this.now()) + DEMO_WATCH_PLAN_TTL_MS).toISOString(),
    };
    this.plans.set(plan.planId, plan);
    return plan;
  }

  async actionApply(planId: string, options?: FixApplyOptions): Promise<FixOutcome> {
    const plan = this.plans.get(planId);
    recordDemoCall({ kind: "watch_action_apply", arg: plan?.actionId ?? planId });
    if (plan === undefined || Date.parse(plan.expiresAt) <= Date.parse(this.now())) return { ok: false, error: "plan_expired", step: null };
    this.plans.delete(planId);
    const of = plan.lines.length;
    try {
      if (plan.needsPassword) {
        options?.onProgress?.({ planId, phase: "waiting_for_password", step: 1, of });
        await wait(this.delayMs, options?.signal);
      }
      for (let step = 1; step <= of; step += 1) {
        options?.onProgress?.({ planId, phase: "running", step, of });
        await wait(this.delayMs, options?.signal);
      }
    } catch {
      return { ok: false, error: "cancelled", step: 1 };
    }
    if (plan.actionId === "watch.wifi_on" || plan.actionId === "watch.allow_incoming") {
      this.set({ closeWatchUntil: new Date(Date.parse(this.now()) + DAY_MS).toISOString(), everyMinutes: 15 });
    }
    return { ok: true };
  }

  async autostartEnable(): Promise<void> {
    recordDemoCall({ kind: "autostart_enable" });
    this.autostart = true;
  }

  async autostartDisable(): Promise<void> {
    recordDemoCall({ kind: "autostart_disable" });
    this.autostart = false;
  }

  async autostartIsEnabled(): Promise<boolean> {
    return this.autostart;
  }

  onState(listener: (state: WatchState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onNotified(listener: (event: { readonly signalId: SignalId }) => void): () => void {
    this.notifiedListeners.add(listener);
    return () => this.notifiedListeners.delete(listener);
  }

  onOpen(listener: (event: { readonly screen: WatchOpenScreen }) => void): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  /** The demo window is never hidden, so nothing is ever shown again. */
  onShown(): () => void {
    return () => undefined;
  }

  /** The kind the flags picked, for tests. */
  get fishyKind(): FishyKind {
    return this.kind;
  }
}
