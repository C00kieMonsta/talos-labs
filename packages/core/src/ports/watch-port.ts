import type { RuleId, RuleStatus, Severity } from "../domain/finding";
import type { Os, UnavailableReason } from "../domain/system-state";
import type { ExplainerProfile } from "./explainer-port";
import type { FixApplyOptions, FixChoice, FixOutcome, FixPlanLine } from "./fix-port";

/**
 * The menu bar watch (docs/DESIGN-WATCH.md). Rust owns the cycle; these are the mirrors the
 * webview, the demo adapter and the fixture parity tests share. No field outside a closed
 * union can hold machine text except the three capped sentences and the validated OS version.
 */

export type Rating = "calm" | "keep_an_eye" | "act_now";
export const RATING_ORDER: readonly Rating[] = ["calm", "keep_an_eye", "act_now"];

export type Change = "same" | "changed" | "first_seen" | "appeared" | "cleared";
export type Freshness = "fresh" | "stale" | "unavailable";

export const SIGNAL_IDS = [
  "sig.persistence_set",
  "sig.persistence_new",
  "sig.persistence_unsigned",
  "sig.persistence_in_temp_or_hidden",
  "sig.helper_tools_count",
  "sig.login_items_count",
  "sig.listener_set",
  "sig.listener_new_ports",
  "sig.established_count",
  "sig.remote_access_on",
  "sig.guest_share",
  "sig.share_count",
  "sig.firewall",
  "sig.gatekeeper",
  "sig.sip",
  "sig.boot_args_set",
  "sig.xprotect_present",
  "sig.xprotect_version",
  "sig.xprotect_remediator_version",
  "sig.xprotect_scans_enabled",
  "sig.admin_count",
  "sig.user_count",
  "sig.hidden_user_count",
  "sig.autologin",
  "sig.profiles_count",
  "sig.mdm_enrolled",
  "sig.managed_prefs_count",
  "sig.sysext_count",
  "sig.kext_count",
  "sig.dns_manual",
  "sig.proxy_on",
  "sig.pac_url_set",
  "sig.resolvers",
  "sig.hosts_changed",
  "sig.authorized_keys_changed",
  "sig.sshd_config_changed",
  "sig.backup_auto",
  "sig.backup_destinations",
  "sig.backup_age_days",
  "sig.cron_lines",
  "sig.at_jobs",
  "sig.legacy_startup_count",
  "sig.lockdown_mode",
  "sig.sudoers_d_count",
  "sig.pam_sudo_changed",
  "sig.remote_logins",
  "sig.load_avg",
  "sig.disk_free_pct",
  "sig.on_battery",
  "sig.pending_updates",
  "sig.broad_extension_count",
] as const;
export type SignalId = (typeof SIGNAL_IDS)[number];

export const PROBE_IDS = [
  "probe.platform_integrity",
  "probe.firewall",
  "probe.malware_protection",
  "probe.remote_access",
  "probe.file_sharing",
  "probe.listeners",
  "probe.accounts",
  "probe.persistence",
  "probe.persistence_signatures",
  "probe.network_config",
  "probe.hosts",
  "probe.profiles",
  "probe.system_extensions",
  "probe.backup",
  "probe.lockdown_mode",
  "probe.sudo_config",
  "probe.ssh_keys",
  "probe.host_metrics",
  "probe.updates",
  "probe.scheduled_jobs",
  "probe.logins",
] as const;
export type ProbeId = (typeof PROBE_IDS)[number];

/** Chosen by the loop only: the two probes that touch file bytes. */
export const RUST_PROBE_IDS: readonly ProbeId[] = ["probe.persistence_signatures", "probe.ssh_keys"];
export type ModelProbeId = Exclude<ProbeId, "probe.persistence_signatures" | "probe.ssh_keys">;
/** PROBE_IDS minus the two Rust-only probes, in PROBE_IDS order. */
export const MODEL_PROBE_IDS: readonly ModelProbeId[] = PROBE_IDS.filter(
  (id): id is ModelProbeId => !RUST_PROBE_IDS.includes(id),
);

export const ACTION_IDS = [
  "act.disconnect_network",
  "act.block_incoming",
  "act.do_not_power_off",
  "act.note_what_you_saw",
  "act.do_not_wait",
  "act.stop_background_program",
  "act.review_background_programs",
  "act.turn_off_remote_access",
  "act.stop_guest_sharing",
  "act.turn_on_firewall",
  "act.turn_on_builtin_protection",
  "act.report",
  "act.change_passwords",
  "act.review_apple_account_devices",
  "act.turn_on_2fa",
  "act.scan_or_reinstall",
  "act.check_backup_before_restore",
  "act.update_now",
  "act.do_not_pay",
  "act.lockdown_mode",
  "act.reconnect_and_watch",
  "act.lessons_learned",
  "act.run_full_checkup",
  "act.get_help",
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export const WATCH_ACTION_IDS = [
  "watch.wifi_off",
  "watch.wifi_on",
  "watch.block_incoming",
  "watch.allow_incoming",
  "watch.stop_user_agent",
  "watch.stop_daemon",
] as const;
export type WatchActionId = (typeof WATCH_ACTION_IDS)[number];

export type FishyKind = "persistence" | "listener" | "guard" | "remote" | "admin" | "dns" | "backup";
export const FISHY_KINDS: readonly FishyKind[] = ["persistence", "listener", "guard", "remote", "admin", "dns", "backup"];

/** The kinds whose flips a person makes in System Settings, asked about before anything else. */
export type GatedKind = "guard" | "remote" | "admin" | "backup";

/** Points for the top-item order; ties by SIGNAL_IDS order. */
export const SIGNAL_POINTS: Readonly<Record<Severity, number>> = { critical: 10, high: 6, medium: 3, low: 1, info: 0 };

/** The fishy kind each signal belongs to; null for the context-only signals that never make an item. */
export const SIGNAL_KIND: Readonly<Record<SignalId, FishyKind | null>> = {
  "sig.persistence_set": "persistence",
  "sig.persistence_new": "persistence",
  "sig.persistence_unsigned": "persistence",
  "sig.persistence_in_temp_or_hidden": "persistence",
  "sig.helper_tools_count": "persistence",
  "sig.login_items_count": "persistence",
  "sig.listener_set": "listener",
  "sig.listener_new_ports": "listener",
  "sig.established_count": null,
  "sig.remote_access_on": "remote",
  "sig.guest_share": "remote",
  "sig.share_count": "remote",
  "sig.firewall": "guard",
  "sig.gatekeeper": "guard",
  "sig.sip": "guard",
  "sig.boot_args_set": "guard",
  "sig.xprotect_present": "guard",
  "sig.xprotect_version": "guard",
  "sig.xprotect_remediator_version": "guard",
  "sig.xprotect_scans_enabled": "guard",
  "sig.admin_count": "admin",
  "sig.user_count": "admin",
  "sig.hidden_user_count": "admin",
  "sig.autologin": "admin",
  "sig.profiles_count": "persistence",
  "sig.mdm_enrolled": "persistence",
  "sig.managed_prefs_count": "persistence",
  "sig.sysext_count": "persistence",
  "sig.kext_count": "persistence",
  "sig.dns_manual": "dns",
  "sig.proxy_on": "dns",
  "sig.pac_url_set": "dns",
  "sig.resolvers": null,
  "sig.hosts_changed": "dns",
  "sig.authorized_keys_changed": "remote",
  "sig.sshd_config_changed": "remote",
  "sig.backup_auto": "backup",
  "sig.backup_destinations": "backup",
  "sig.backup_age_days": null,
  "sig.cron_lines": "persistence",
  "sig.at_jobs": "persistence",
  "sig.legacy_startup_count": "persistence",
  "sig.lockdown_mode": "guard",
  "sig.sudoers_d_count": "admin",
  "sig.pam_sudo_changed": "admin",
  "sig.remote_logins": "remote",
  "sig.load_avg": null,
  "sig.disk_free_pct": null,
  "sig.on_battery": null,
  "sig.pending_updates": null,
  "sig.broad_extension_count": null,
};

export interface WatchSignal {
  readonly signalId: SignalId;
  /** Digest kinds carry only the Change; a reading without a value carries its Change too. */
  readonly value: boolean | number | Change;
  /** Never for digest kinds. */
  readonly previous: boolean | number | null;
  readonly severity: Severity;
  readonly change: Change;
  readonly minutesSinceChange: number | null;
  readonly freshness: Freshness;
  /** "This is fine, I know it" or "Yes, that was me" is set. */
  readonly acknowledged: boolean;
  /** A person-made flip awaiting "Did you just change this?". */
  readonly gated: boolean;
}

export type RuleChange = "none" | "appeared" | "fixed" | "unreadable";

export interface WatchRule {
  readonly ruleId: RuleId;
  readonly status: RuleStatus;
  readonly severity: Severity;
  readonly change: RuleChange;
  readonly minutesSinceChange: number | null;
}

export interface WatchCycle {
  readonly index: number;
  readonly minutesSinceFullCheck: number;
  readonly minutesSinceLastChange: number | null;
  readonly probesLeft: number;
}

export interface WatchRecent {
  readonly signalId: SignalId;
  readonly change: Change;
  readonly minutesAgo: number;
}

export interface WatchLastVerdict {
  readonly rating: Rating;
  readonly minutesAgo: number;
}

/** The only document the model receives for the watch task. */
export interface WatchContext {
  readonly schemaVersion: 1;
  readonly os: Os;
  /** Regex-validated. */
  readonly osVersion: string;
  readonly profile: ExplainerProfile;
  readonly cycle: WatchCycle;
  /** Code-computed; the model may not go below. */
  readonly floor: Rating;
  /** Code-computed; the model may not go above. */
  readonly ceiling: Rating;
  /** At most 64 rows, unique ruleId, no evidence. */
  readonly rules: readonly WatchRule[];
  readonly signals: readonly WatchSignal[];
  /** The last 20 changes. */
  readonly recent: readonly WatchRecent[];
  readonly probesAvailable: readonly ModelProbeId[];
  readonly actionsAvailable: readonly ActionId[];
  readonly lastVerdict: WatchLastVerdict | null;
}

export interface WatchVerdict {
  readonly rating: Rating;
  /** <= 300 chars; shown on Advise rows only. */
  readonly ratingReason: string;
  /** <= 6. */
  readonly basedOn: readonly SignalId[];
  /** <= 3. */
  readonly probes: readonly { readonly probeId: ModelProbeId; readonly reason: string }[];
  /** <= 3. */
  readonly actions: readonly { readonly actionId: ActionId; readonly sentence: string }[];
}

export const WATCH_LIMITS = {
  maxPromptChars: 12000,
  maxOutputTokens: 1200,
  maxReasonChars: 300,
  maxBasedOn: 6,
  maxProbes: 3,
  maxActions: 3,
  maxRecent: 20,
  maxRules: 64,
} as const;

export type WatchInterval = 15 | 60 | 240;
export const WATCH_INTERVALS: readonly WatchInterval[] = [15, 60, 240];

export type WatchOpenScreen = "home" | "noticed" | "settings_watch";

export type WatchModelProvider = "apple" | "chatgpt" | "claude_plan";

/** What the webview tells Rust about the AI layer: whether it is on and which consumer provider is chosen (null lets Rust pick a connected one). */
export interface WatchAi {
  readonly enabled: boolean;
  readonly provider: WatchModelProvider | null;
}

export interface WatchItem {
  readonly signalId: SignalId;
  readonly kind: FishyKind;
  readonly severity: Severity;
  readonly points: number;
  readonly change: Change;
  readonly changedAt: string | null;
  readonly gated: boolean;
  readonly snoozedUntil: string | null;
  readonly hasStartupEntry: boolean;
  readonly isListener: boolean;
  readonly actionIds: readonly ActionId[];
  readonly modelSentence: string | null;
  readonly modelProvider: WatchModelProvider | null;
}

export interface UnavailableProbe {
  readonly probeId: ProbeId;
  readonly reason: UnavailableReason;
}

export interface WatchState {
  /** The person's switch. */
  readonly enabled: boolean;
  /** The product gate the webview last reported; the watch is active only when enabled and licensed. */
  readonly licensed: boolean;
  readonly firstRun: boolean;
  /** True from a `--watch` login launch until the main window is first shown; the launch check-up waits for it. */
  readonly hiddenLaunch: boolean;
  readonly rating: Rating;
  readonly since: string | null;
  readonly lastCheckAt: string | null;
  readonly checking: boolean;
  readonly cycleIndex: number;
  readonly everyMinutes: WatchInterval;
  readonly notify: boolean;
  readonly pausedUntil: string | null;
  readonly closeWatchUntil: string | null;
  readonly unavailable: readonly UnavailableProbe[];
  readonly gated: readonly SignalId[];
  /**
   * Sorted by points desc then SIGNAL_IDS order; the first is the top item. Only kinded signals
   * (SIGNAL_KIND != null) with change != same and not acknowledged appear.
   */
  readonly items: readonly WatchItem[];
}

export type WatchDetailsScope = "user_agent" | "system_agent" | "system_daemon";

export interface WatchDetailsItem {
  readonly signalId: SignalId;
  readonly plistPath?: string;
  readonly label?: string;
  readonly programPath?: string;
  readonly scope?: WatchDetailsScope;
  readonly port?: number;
  readonly processName?: string;
}

/** The one document that carries machine text. Never an adapter argument, never persisted. */
export interface WatchDetails {
  readonly items: readonly WatchDetailsItem[];
  readonly wifiAvailable: boolean;
}

export interface WatchPlan {
  readonly planId: string;
  readonly actionId: WatchActionId;
  readonly lines: readonly FixPlanLine[];
  readonly needsPassword: boolean;
  readonly reversible: string | null;
  /** ISO 8601. Five minutes after preview. */
  readonly expiresAt: string;
}

/** localStorage["talos.watch"]. Keys validated against SIGNAL_IDS and ACTION_IDS; ids and dates only. */
export interface WatchMemory {
  readonly version: 1;
  readonly snoozedSignals: Readonly<Record<string, string>>;
  readonly normalForMe: Readonly<Record<string, string>>;
  readonly acknowledgeCount: Readonly<Record<string, number>>;
  readonly actionNotNow: Readonly<Record<string, string>>;
  readonly fishyRanAt: string | null;
  readonly notifiedItems: Readonly<Record<string, string>>;
  /** The one record that macOS's notification permission has been asked for; written by the controller's requestNotifyPermission on success. */
  readonly notifyAskedAt: string | null;
}

/**
 * Implemented by the desktop app over Tauri commands. The `limited` adapter used by the watch
 * window implements only status, checkNow, pause and openMain; every other method rejects
 * with "forbidden_window".
 */
export interface WatchPort {
  status(): Promise<WatchState>;
  checkNow(): Promise<void>;
  pause(minutes: 60): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  setInterval(minutes: WatchInterval): Promise<void>;
  /** Records the flag only; never prompts. */
  setNotify(enabled: boolean): Promise<void>;
  /** The only path to macOS's permission alert. */
  requestNotifyPermission(): Promise<void>;
  /**
   * The Rust copy of the profile for WatchContext, plus the AI switch and provider choice when known;
   * Rust auto-picks a connected provider without `ai`. `licensed` is the product gate the webview
   * reports; Rust runs the watch only when enabled and licensed and never verifies a key.
   */
  setProfile(profile: ExplainerProfile, ai: WatchAi | undefined, licensed: boolean): Promise<void>;
  acknowledge(signalId: SignalId): Promise<void>;
  answerGate(signalId: SignalId, mine: boolean): Promise<void>;
  snooze(signalId: SignalId): Promise<void>;
  context(): Promise<WatchContext>;
  details(): Promise<WatchDetails>;
  openMain(screen: WatchOpenScreen): Promise<void>;
  openSource(actionId: ActionId): Promise<void>;
  actionPreview(actionId: WatchActionId, choice: FixChoice): Promise<WatchPlan>;
  actionApply(planId: string, options?: FixApplyOptions): Promise<FixOutcome>;
  autostartEnable(): Promise<void>;
  autostartDisable(): Promise<void>;
  autostartIsEnabled(): Promise<boolean>;
  onState(listener: (state: WatchState) => void): () => void;
  onNotified(listener: (event: { readonly signalId: SignalId }) => void): () => void;
  onOpen(listener: (event: { readonly screen: WatchOpenScreen }) => void): () => void;
  /** A hidden main window was shown; `home` for a plain open (Dock, second launch). The launch check-up runs on it. */
  onShown(listener: (event: { readonly screen: WatchOpenScreen }) => void): () => void;
}
