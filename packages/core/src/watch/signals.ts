import type { Severity } from "../domain/finding";
import type { Change, FishyKind, Freshness, SignalId, WatchSignal } from "../ports/watch-port";
import { SIGNAL_KIND } from "../ports/watch-port";

export { SIGNAL_KIND };

/** The severity each signal carries into the context. Mirrored by Rust watch/signals.rs. */
export const SIGNAL_SEVERITY: Readonly<Record<SignalId, Severity>> = {
  "sig.persistence_set": "medium",
  "sig.persistence_new": "high",
  "sig.persistence_unsigned": "high",
  "sig.persistence_in_temp_or_hidden": "high",
  "sig.helper_tools_count": "medium",
  "sig.login_items_count": "medium",
  "sig.listener_set": "medium",
  "sig.listener_new_ports": "high",
  "sig.established_count": "low",
  "sig.remote_access_on": "high",
  "sig.guest_share": "high",
  "sig.share_count": "medium",
  "sig.firewall": "high",
  "sig.gatekeeper": "high",
  "sig.sip": "high",
  "sig.boot_args_set": "high",
  "sig.xprotect_present": "high",
  "sig.xprotect_version": "high",
  "sig.xprotect_remediator_version": "medium",
  "sig.xprotect_scans_enabled": "high",
  "sig.admin_count": "high",
  "sig.user_count": "medium",
  "sig.hidden_user_count": "high",
  "sig.autologin": "high",
  "sig.profiles_count": "high",
  "sig.mdm_enrolled": "medium",
  "sig.managed_prefs_count": "medium",
  "sig.sysext_count": "high",
  "sig.kext_count": "medium",
  "sig.dns_manual": "high",
  "sig.proxy_on": "medium",
  "sig.pac_url_set": "high",
  "sig.resolvers": "low",
  "sig.hosts_changed": "medium",
  "sig.authorized_keys_changed": "high",
  "sig.sshd_config_changed": "medium",
  "sig.backup_auto": "high",
  "sig.backup_destinations": "medium",
  "sig.backup_age_days": "low",
  "sig.cron_lines": "high",
  "sig.at_jobs": "medium",
  "sig.legacy_startup_count": "medium",
  "sig.lockdown_mode": "medium",
  "sig.sudoers_d_count": "high",
  "sig.pam_sudo_changed": "high",
  "sig.remote_logins": "high",
  "sig.load_avg": "info",
  "sig.disk_free_pct": "info",
  "sig.on_battery": "info",
  "sig.pending_updates": "low",
  "sig.broad_extension_count": "medium",
};

/** Flips a person makes in System Settings: asked "Did you just change this?" before anything else. */
export const GATED_SIGNALS: readonly SignalId[] = [
  "sig.firewall",
  "sig.remote_access_on",
  "sig.guest_share",
  "sig.autologin",
  "sig.admin_count",
  "sig.backup_auto",
];

/** Flips that need Recovery or root: one alone is act now. */
export const STAND_ALONE_SIGNALS: readonly SignalId[] = [
  "sig.sip",
  "sig.gatekeeper",
  "sig.xprotect_present",
  "sig.xprotect_scans_enabled",
  "sig.xprotect_version",
  "sig.hidden_user_count",
];

/** Two of these (or a gated flip) within 24 h is act now. */
export const PAIR_SIGNALS: readonly SignalId[] = [
  "sig.persistence_new",
  "sig.persistence_unsigned",
  "sig.persistence_in_temp_or_hidden",
  "sig.listener_new_ports",
  "sig.dns_manual",
  "sig.pac_url_set",
  "sig.profiles_count",
  "sig.sysext_count",
  "sig.authorized_keys_changed",
  "sig.cron_lines",
];

/** Signals derived from one listing; Rust `signals::siblings` is the same table. */
const SIBLINGS: Readonly<Partial<Record<SignalId, readonly SignalId[]>>> = {
  "sig.persistence_set": ["sig.persistence_set", "sig.persistence_new", "sig.persistence_unsigned", "sig.persistence_in_temp_or_hidden"],
  "sig.persistence_new": ["sig.persistence_set", "sig.persistence_new", "sig.persistence_unsigned", "sig.persistence_in_temp_or_hidden"],
  "sig.persistence_unsigned": ["sig.persistence_set", "sig.persistence_new", "sig.persistence_unsigned", "sig.persistence_in_temp_or_hidden"],
  "sig.persistence_in_temp_or_hidden": ["sig.persistence_set", "sig.persistence_new", "sig.persistence_unsigned", "sig.persistence_in_temp_or_hidden"],
  "sig.listener_set": ["sig.listener_set", "sig.listener_new_ports"],
  "sig.listener_new_ports": ["sig.listener_set", "sig.listener_new_ports"],
};

/** The signal and the others derived from the same listing. */
export function siblings(signalId: SignalId): readonly SignalId[] {
  return SIBLINGS[signalId] ?? [signalId];
}

/** The listing a pair signal comes from, so three counters from one listing count once. */
export function pairGroup(signalId: SignalId): SignalId {
  return siblings(signalId)[0] ?? signalId;
}

/** The direction that counts for a kinded boolean, count or version signal. */
export type BadDirection = "true" | "false" | "up" | "down";

/**
 * Every kinded signal but the digest and stat kinds has a row: the headlines all name a bad
 * direction, so a Remediator update or a share removed makes no item. Rust `bad_direction` is
 * the same table.
 */
export const BAD_DIRECTION: Readonly<Partial<Record<SignalId, BadDirection>>> = {
  "sig.sip": "false",
  "sig.gatekeeper": "false",
  "sig.boot_args_set": "true",
  "sig.xprotect_present": "false",
  "sig.xprotect_scans_enabled": "false",
  "sig.xprotect_version": "down",
  "sig.xprotect_remediator_version": "down",
  "sig.lockdown_mode": "false",
  "sig.hidden_user_count": "up",
  "sig.firewall": "false",
  "sig.remote_access_on": "true",
  "sig.guest_share": "true",
  "sig.share_count": "up",
  "sig.autologin": "true",
  "sig.admin_count": "up",
  "sig.user_count": "up",
  "sig.backup_auto": "false",
  "sig.backup_destinations": "down",
  "sig.persistence_new": "up",
  "sig.persistence_unsigned": "up",
  "sig.persistence_in_temp_or_hidden": "up",
  "sig.helper_tools_count": "up",
  "sig.login_items_count": "up",
  "sig.listener_new_ports": "up",
  "sig.dns_manual": "true",
  "sig.pac_url_set": "true",
  "sig.proxy_on": "true",
  "sig.profiles_count": "up",
  "sig.mdm_enrolled": "true",
  "sig.managed_prefs_count": "up",
  "sig.sysext_count": "up",
  "sig.kext_count": "up",
  "sig.authorized_keys_changed": "true",
  "sig.cron_lines": "up",
  "sig.at_jobs": "up",
  "sig.legacy_startup_count": "up",
  "sig.sudoers_d_count": "up",
  "sig.remote_logins": "up",
  "sig.broad_extension_count": "up",
};

/** True when the signal changed in the direction its row names. A signal with no row never flips. */
export function badFlip(signal: Pick<WatchSignal, "signalId" | "value" | "previous" | "change">): boolean {
  if (signal.change === "same") return false;
  const direction = BAD_DIRECTION[signal.signalId];
  if (direction === undefined) return false;
  const { value, previous } = signal;
  switch (direction) {
    case "true":
      return value === true;
    case "false":
      return value === false;
    case "up":
      return typeof value === "number" && value > (typeof previous === "number" ? previous : 0);
    case "down":
      return typeof value === "number" && typeof previous === "number" && value < previous;
  }
}

/** The kind a signal makes an item under, or null for context-only signals. */
export function kindOf(signalId: SignalId): FishyKind | null {
  return SIGNAL_KIND[signalId];
}

export type SignalValueKind = "bool" | "count" | "version" | "digest";

/**
 * What Rust's probes reduce a signal to, before toWatchContext turns it into a WatchSignal.
 * The demo adapter and the fixture cases build these by hand.
 */
export interface SignalReading {
  readonly signalId: SignalId;
  readonly kind: SignalValueKind;
  readonly value: boolean | number | null;
  readonly previous: boolean | number | null;
  readonly change: Change;
  readonly changedAt: string | null;
  readonly freshness: Freshness;
  readonly previousFreshness: Freshness | null;
  readonly gateAnswer: "mine" | "not_mine" | null;
  readonly codesignValid?: boolean;
  /** A Talos fix within 10 minutes of the change holds the signal for a cycle. */
  readonly fixedByTalosAt?: string | null;
  readonly hasStartupEntry?: boolean;
  readonly isListener?: boolean;
}
