import { describe, expect, it } from "vitest";
import type { Change, SignalId, WatchContext, WatchSignal } from "../../src/ports/watch-port";
import { ACTION_IDS, MODEL_PROBE_IDS, SIGNAL_IDS, SIGNAL_KIND, WATCH_LIMITS } from "../../src/ports/watch-port";
import { CONTEXT_CASES, RATE_CASES } from "../../src/watch/cases";
import { LISTING_DIGESTS, applyHysteresis, boundsFor, maxRating, minRating, rateWatch, topItems } from "../../src/watch/rate";
import { BAD_DIRECTION, GATED_SIGNALS, PAIR_SIGNALS, SIGNAL_SEVERITY, STAND_ALONE_SIGNALS, badFlip, pairGroup, siblings } from "../../src/watch/signals";

function sig(signalId: SignalId, over: Partial<WatchSignal> = {}): WatchSignal {
  return { signalId, value: false, previous: null, severity: SIGNAL_SEVERITY[signalId], change: "same", minutesSinceChange: null, freshness: "fresh", acknowledged: false, gated: false, ...over };
}

function changed(signalId: SignalId, value: boolean | number | Change, previous: boolean | number | null, minutes = 30, over: Partial<WatchSignal> = {}): WatchSignal {
  return sig(signalId, { value, previous, change: "changed", minutesSinceChange: minutes, ...over });
}

function ctx(signals: readonly WatchSignal[], over: Partial<WatchContext> = {}): WatchContext {
  const bounds = boundsFor(signals, over.rules ?? []);
  return {
    schemaVersion: 1,
    os: "macos",
    osVersion: "27.0.1",
    profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true },
    cycle: { index: 2, minutesSinceFullCheck: 10, minutesSinceLastChange: null, probesLeft: 3 },
    floor: bounds.floor,
    ceiling: bounds.ceiling,
    rules: [],
    signals,
    recent: [],
    probesAvailable: MODEL_PROBE_IDS,
    actionsAvailable: ACTION_IDS,
    lastVerdict: null,
    ...over,
  };
}

const byName = (prefix: string) => RATE_CASES.filter((c) => c.name.startsWith(prefix));

describe("the fixture set", () => {
  it("holds at least ten calm, ten look and ten act cases, each landing where its name says", () => {
    expect(byName("calm:").length).toBeGreaterThanOrEqual(10);
    expect(byName("look:").length).toBeGreaterThanOrEqual(10);
    expect(byName("act:").length).toBeGreaterThanOrEqual(10);
    for (const c of byName("calm:")) expect(c.expected, c.name).toBe("calm");
    for (const c of byName("look:")) expect(c.expected, c.name).toBe("keep_an_eye");
    for (const c of byName("act:")) expect(c.expected, c.name).toBe("act_now");
  });

  it("covers each stand-alone trigger, each pair and a gate answered No", () => {
    const names = byName("act:").map((c) => c.name).join("\n");
    for (const word of ["SIP", "Gatekeeper", "XProtect went missing", "XProtect scans", "version went down", "hidden account", "new listener", "PAC URL", "system extension", "cron line", "unanswered gate", "answered No", "authenticated root", "Internet Sharing", "unsigned label", "unchecked unsigned app", "shell start-up file"]) {
      expect(names).toContain(word);
    }
  });

  it("the new signals land where DESIGN-THREATS-V2 section 9 says", () => {
    const find = (name: string) => {
      const c = RATE_CASES.find((x) => x.name === name);
      if (c === undefined) throw new Error(`no case named ${name}`);
      return c;
    };
    expect(find("act: authenticated root went off").expectedItems).toEqual(["sig.authenticated_root"]);
    const airdrop = find("look: AirDrop open to everyone alone, with no gate");
    expect(airdrop.expectedItems).toEqual(["sig.airdrop_everyone"]);
    expect(airdrop.context.signals.some((s) => s.gated)).toBe(false);
    expect(find("look: Internet Sharing came on, an unanswered gate").context.signals.some((s) => s.signalId === "sig.internet_sharing_on" && s.gated)).toBe(true);
    expect(find("look: an unchecked unsigned app alone is one app item").expectedItems).toEqual(["sig.app_new_unsigned"]);
    expect(topItems(find("look: an unchecked unsigned app alone is one app item").context.signals).map((i) => i.kind)).toEqual(["app"]);
    expect(find("act: an unchecked unsigned app and a new launch agent").expectedItems).toEqual(["sig.persistence_new", "sig.app_new_unsigned"]);
    expect(find("look: a new App Store app with no download mark alone makes no item").expectedItems).toEqual([]);
    expect(find("look: more apps hidden in the library alone makes no item").expectedItems).toEqual([]);
    expect(find("look: a new App Store app and a new signed launch agent within a day").expectedItems).toEqual(["sig.persistence_new"]);
    const zshrc = find("look: ~/.zshrc changed alone is keep_an_eye with one shell item");
    expect(zshrc.expectedItems).toEqual(["sig.shell_startup_changed"]);
    expect(topItems(zshrc.context.signals).map((i) => i.kind)).toEqual(["shell"]);
    expect(new Set(find("act: a shell start-up file and a new launch agent").expectedItems)).toEqual(new Set(["sig.shell_startup_changed", "sig.persistence_new"]));
    expect(find("look: a new /etc/zshenv changes two shell signals and is one item").expectedItems).toEqual(["sig.shell_startup_changed"]);
    expect(find("look: a label that pretends to be Apple's alone is one item").expectedItems).toHaveLength(1);
    expect(find("act: an unsigned label that pretends to be Apple's is act now on one listing").expectedItems).toHaveLength(1);
    expect(find("calm: a PAM file that moved with a build change arrives unchanged and makes no item").expectedItems).toEqual([]);
  });

  it("the first cycle rates nothing even with SIP off and a model saying act_now", () => {
    const c = RATE_CASES.find((x) => x.name === "calm: the first cycle rates nothing");
    expect(c?.context.cycle.index).toBe(0);
    expect(c?.expectedBounds.floor).toBe("act_now");
    expect(c?.expected).toBe("calm");
  });

  it("the four unavailable states are never calm and make no item", () => {
    const unavailable = RATE_CASES.filter((c) => c.name.includes("became unreadable"));
    expect(unavailable).toHaveLength(4);
    for (const c of unavailable) {
      expect(c.expected, c.name).toBe("keep_an_eye");
      expect(c.expectedItems, c.name).toEqual([]);
    }
  });

  it("a good flip is something to look at with no headline", () => {
    const good = RATE_CASES.filter((c) => c.name.includes("a good flip"));
    expect(good).toHaveLength(2);
    for (const c of good) {
      expect(c.expected, c.name).toBe("keep_an_eye");
      expect(c.expectedItems, c.name).toEqual([]);
    }
  });

  it("act_now with no item is capped at keep_an_eye", () => {
    const c = RATE_CASES.find((x) => x.name.includes("no item is capped"));
    expect(c?.context.floor).toBe("act_now");
    expect(c?.expectedItems).toEqual([]);
    expect(c?.expected).toBe("keep_an_eye");
  });
});

describe("boundsFor", () => {
  it("is calm with no signals and calm with unchanged ones", () => {
    expect(boundsFor([])).toEqual({ floor: "calm", ceiling: "calm" });
    expect(boundsFor([sig("sig.sip", { value: true, previous: true })])).toEqual({ floor: "calm", ceiling: "calm" });
  });

  it("a stand-alone flip in the bad direction is act now; the other direction is only a change", () => {
    expect(boundsFor([changed("sig.sip", false, true)]).floor).toBe("act_now");
    expect(boundsFor([changed("sig.sip", true, false)])).toEqual({ floor: "keep_an_eye", ceiling: "act_now" });
    expect(boundsFor([changed("sig.xprotect_version", 5300, 5311)]).floor).toBe("act_now");
    expect(boundsFor([changed("sig.xprotect_version", 5312, 5311)]).floor).toBe("keep_an_eye");
    expect(boundsFor([changed("sig.hidden_user_count", 1, 0)]).floor).toBe("act_now");
    expect(boundsFor([changed("sig.hidden_user_count", 0, 1)]).floor).toBe("keep_an_eye");
  });

  it("an unanswered gate is look with a look ceiling; answered No it is act now", () => {
    expect(boundsFor([changed("sig.firewall", false, true, 5, { gated: true })])).toEqual({ floor: "keep_an_eye", ceiling: "keep_an_eye" });
    expect(boundsFor([changed("sig.firewall", false, true, 5)])).toEqual({ floor: "act_now", ceiling: "act_now" });
  });

  it("two pair signals within a day are act now; one, or two a day apart, are not", () => {
    expect(boundsFor([changed("sig.persistence_new", 1, 0), changed("sig.dns_manual", true, false)]).floor).toBe("act_now");
    expect(boundsFor([changed("sig.persistence_new", 1, 0)]).floor).toBe("keep_an_eye");
    expect(boundsFor([changed("sig.persistence_new", 1, 0), changed("sig.dns_manual", true, false, 1441)]).floor).toBe("keep_an_eye");
    expect(boundsFor([changed("sig.persistence_new", 1, 0), changed("sig.firewall", false, true, 5, { gated: true })]).floor).toBe("act_now");
  });

  it("the three persistence counters from one listing count as one pair", () => {
    const lone = [changed("sig.persistence_new", 1, 0), changed("sig.persistence_unsigned", 1, 0), changed("sig.persistence_in_temp_or_hidden", 1, 0)];
    expect(boundsFor(lone)).toEqual({ floor: "keep_an_eye", ceiling: "act_now" });
    expect(boundsFor([...lone, changed("sig.dns_manual", true, false)]).floor).toBe("act_now");
    expect(boundsFor([...lone, changed("sig.listener_new_ports", 1, 0)]).floor).toBe("act_now");
    expect(pairGroup("sig.persistence_unsigned")).toBe("sig.persistence_set");
    expect(pairGroup("sig.listener_new_ports")).toBe("sig.listener_set");
    expect(pairGroup("sig.dns_manual")).toBe("sig.dns_manual");
    expect(siblings("sig.firewall")).toEqual(["sig.firewall"]);
  });

  it("acknowledged signals count for nothing", () => {
    expect(boundsFor([changed("sig.sip", false, true, 5, { acknowledged: true })])).toEqual({ floor: "calm", ceiling: "calm" });
  });

  it("a rule that appeared and a signal that just became unavailable raise the floor", () => {
    expect(boundsFor([], [{ ruleId: "TL-MAC-001", status: "fail", severity: "high", change: "appeared", minutesSinceChange: 1 }]).floor).toBe("keep_an_eye");
    expect(boundsFor([], [{ ruleId: "TL-MAC-001", status: "pass", severity: "high", change: "fixed", minutesSinceChange: 1 }]).floor).toBe("calm");
    expect(boundsFor([sig("sig.load_avg", { value: "changed", change: "changed", freshness: "unavailable" })]).floor).toBe("keep_an_eye");
    expect(boundsFor([sig("sig.load_avg", { value: "same", freshness: "unavailable" })]).floor).toBe("calm");
  });

  it("the ceiling is act now only for an unacknowledged, ungated high change", () => {
    expect(boundsFor([changed("sig.share_count", 2, 1)]).ceiling).toBe("keep_an_eye");
    expect(boundsFor([changed("sig.persistence_new", 1, 0)]).ceiling).toBe("act_now");
    expect(boundsFor([changed("sig.persistence_new", 1, 0, 5, { gated: true })]).ceiling).toBe("keep_an_eye");
  });
});

describe("rateWatch", () => {
  it("takes the floor with no verdict and clamps a verdict between floor and ceiling", () => {
    const look = ctx([changed("sig.share_count", 2, 1)]);
    expect(rateWatch(look, null)).toBe("keep_an_eye");
    expect(rateWatch(look, { rating: "act_now" })).toBe("keep_an_eye");
    expect(rateWatch(look, { rating: "calm" })).toBe("keep_an_eye");
    const act = ctx([changed("sig.sip", false, true)]);
    expect(rateWatch(act, { rating: "calm" })).toBe("act_now");
    // Any unacknowledged change lifts the ceiling to keep_an_eye, even an info one; no change keeps it calm.
    expect(rateWatch(ctx([changed("sig.load_avg", 9, 1)]), { rating: "act_now" })).toBe("keep_an_eye");
    expect(rateWatch(ctx([sig("sig.load_avg", { value: 1, previous: 1 })]), { rating: "act_now" })).toBe("calm");
  });

  it("the first cycle is calm whatever the signals say", () => {
    expect(rateWatch(ctx([changed("sig.sip", false, true)], { cycle: { index: 0, minutesSinceFullCheck: 0, minutesSinceLastChange: null, probesLeft: 3 } }), { rating: "act_now" })).toBe("calm");
  });

  it("caps act_now at keep_an_eye when no kinded signal changed", () => {
    expect(rateWatch(ctx([changed("sig.pending_updates", 2, 1)], { floor: "act_now", ceiling: "act_now" }), null)).toBe("keep_an_eye");
    expect(rateWatch(ctx([], { floor: "act_now", ceiling: "act_now" }), { rating: "act_now" })).toBe("keep_an_eye");
  });
});

describe("topItems", () => {
  it("keeps kinded, changed, unacknowledged signals by points then catalogue order", () => {
    const items = topItems([
      changed("sig.share_count", 2, 1),
      changed("sig.sip", false, true),
      changed("sig.persistence_new", 1, 0),
      changed("sig.load_avg", 9, 1),
      changed("sig.firewall", false, true, 5, { acknowledged: true }),
      sig("sig.admin_count", { value: 1, previous: 1 }),
      changed("sig.established_count", 9, 4),
    ]);
    // established_count is context only, so it makes no item.
    expect(items.map((i) => i.signalId)).toEqual(["sig.persistence_new", "sig.sip", "sig.share_count"]);
    expect(items[0]).toEqual({ signalId: "sig.persistence_new", kind: "persistence", points: 6 });
    expect(items[2]?.points).toBe(3);
  });

  it("includes gated signals, so a gate is an item the window can show", () => {
    expect(topItems([changed("sig.remote_access_on", true, false, 5, { gated: true })]).map((i) => i.kind)).toEqual(["remote"]);
  });

  it("skips a good flip, a cleared change and an unreadable probe, whose headlines would be false", () => {
    expect(topItems([changed("sig.firewall", true, false)])).toEqual([]);
    expect(topItems([changed("sig.admin_count", 1, 2)])).toEqual([]);
    expect(topItems([sig("sig.share_count", { value: 1, previous: 2, change: "cleared", minutesSinceChange: 1 })])).toEqual([]);
    expect(topItems([sig("sig.listener_set", { value: "changed", change: "changed", minutesSinceChange: 0, freshness: "unavailable" })])).toEqual([]);
    expect(topItems([changed("sig.share_count", 2, 1)]).map((i) => i.signalId)).toEqual(["sig.share_count"]);
  });

  it("makes one item per listing, under the highest counter, so a new agent is one thing to look at", () => {
    const agent = [changed("sig.persistence_set", "changed", null), changed("sig.persistence_new", 1, 0), changed("sig.persistence_unsigned", 1, 0), changed("sig.persistence_in_temp_or_hidden", 1, 0), changed("sig.listener_set", "changed", null), changed("sig.listener_new_ports", 1, 0)];
    expect(topItems(agent).map((i) => i.signalId)).toEqual(["sig.persistence_new", "sig.listener_new_ports"]);
    const acked = agent.map((s) => (s.signalId === "sig.persistence_new" ? { ...s, acknowledged: true } : s));
    expect(topItems(acked).map((i) => i.signalId)).toEqual(["sig.persistence_unsigned", "sig.listener_new_ports"]);
  });

  it("gives a removed launch item or a closed listener no headline, while the change still looks", () => {
    const removed = [changed("sig.persistence_set", "changed", null), sig("sig.persistence_new", { value: 0, previous: 0 })];
    expect(topItems(removed)).toEqual([]);
    expect(boundsFor(removed).floor).toBe("keep_an_eye");
    expect(topItems([changed("sig.listener_set", "changed", null)])).toEqual([]);
    expect(topItems([changed("sig.hosts_changed", "changed", null)]).map((i) => i.signalId)).toEqual(["sig.hosts_changed"]);
  });

  it("listingWorthy is scoped to the three listing digests; every other digest is an item on its own", () => {
    expect(LISTING_DIGESTS).toEqual(["sig.persistence_set", "sig.listener_set", "sig.app_set"]);
    expect(topItems([changed("sig.app_set", "changed", null)])).toEqual([]);
    expect(topItems([changed("sig.app_set", "changed", null), changed("sig.app_new_unsigned", 1, 0)]).map((i) => i.signalId)).toEqual(["sig.app_new_unsigned"]);
    // A context-only sibling never makes the listing an item.
    expect(topItems([changed("sig.app_set", "changed", null), changed("sig.app_new_unquarantined", 1, 0)])).toEqual([]);
    expect(topItems([changed("sig.shell_startup_changed", "changed", null)]).map((i) => i.signalId)).toEqual(["sig.shell_startup_changed"]);
    expect(topItems([changed("sig.paths_d_changed", "changed", null)]).map((i) => i.signalId)).toEqual(["sig.paths_d_changed"]);
    expect(topItems([changed("sig.pam_auth_changed", "changed", null)]).map((i) => i.signalId)).toEqual(["sig.pam_auth_changed"]);
    expect(topItems([changed("sig.authorized_keys_changed", "changed", null)]).map((i) => i.signalId)).toEqual(["sig.authorized_keys_changed"]);
  });

  it("a shell file and a launch agent within a day are act now; a shell file alone is one shell item", () => {
    expect(boundsFor([changed("sig.shell_startup_changed", "changed", null)])).toEqual({ floor: "keep_an_eye", ceiling: "keep_an_eye" });
    expect(boundsFor([changed("sig.shell_startup_changed", "changed", null), changed("sig.persistence_new", 1, 0)]).floor).toBe("act_now");
    expect(boundsFor([changed("sig.shell_startup_changed", "changed", null), changed("sig.system_shell_files_count", 1, 0), changed("sig.paths_d_changed", "changed", null)]).floor).toBe("keep_an_eye");
    expect(pairGroup("sig.paths_d_changed")).toBe("sig.shell_startup_changed");
    expect(pairGroup("sig.path_dir_writable_count")).toBe("sig.shell_startup_changed");
    expect(pairGroup("sig.app_new_unsigned")).toBe("sig.app_set");
    expect(pairGroup("sig.launch_label_masquerade")).toBe("sig.persistence_set");
    expect(pairGroup("sig.launch_label_masquerade_unsigned")).toBe("sig.persistence_set");
    expect(siblings("sig.shell_startup_changed")).toEqual(["sig.shell_startup_changed", "sig.system_shell_files_count", "sig.paths_d_changed", "sig.path_dir_writable_count"]);
    expect(siblings("sig.app_set")).toEqual(["sig.app_set", "sig.app_new_unquarantined", "sig.app_new_unsigned"]);
    expect(siblings("sig.persistence_set")).toHaveLength(6);
  });
});

describe("applyHysteresis", () => {
  it("rises at once and resets the streak", () => {
    expect(applyHysteresis("calm", "act_now", 1)).toEqual({ rating: "act_now", calmStreak: 0 });
    expect(applyHysteresis("keep_an_eye", "keep_an_eye", 1)).toEqual({ rating: "keep_an_eye", calmStreak: 0 });
  });

  it("falls only on the second consecutive lower cycle", () => {
    const first = applyHysteresis("act_now", "calm", 0);
    expect(first).toEqual({ rating: "act_now", calmStreak: 1 });
    expect(applyHysteresis("act_now", "calm", first.calmStreak)).toEqual({ rating: "calm", calmStreak: 0 });
    expect(applyHysteresis("act_now", "keep_an_eye", 1)).toEqual({ rating: "keep_an_eye", calmStreak: 0 });
  });

  it("maxRating and minRating follow the order calm < keep_an_eye < act_now", () => {
    expect(maxRating("calm", "act_now")).toBe("act_now");
    expect(minRating("keep_an_eye", "act_now")).toBe("keep_an_eye");
    expect(maxRating("keep_an_eye", "calm")).toBe("keep_an_eye");
  });
});

describe("the signal tables", () => {
  it("severity and kind are total over SIGNAL_IDS", () => {
    for (const id of SIGNAL_IDS) {
      expect(SIGNAL_SEVERITY[id], id).toBeDefined();
      expect(id in SIGNAL_KIND, id).toBe(true);
    }
    expect(Object.keys(SIGNAL_SEVERITY)).toEqual([...SIGNAL_IDS]);
    expect(Object.keys(SIGNAL_KIND)).toEqual([...SIGNAL_IDS]);
  });

  it("every stand-alone and gated signal is high; every pair signal is high or medium; all kinded with a bad direction", () => {
    for (const id of [...STAND_ALONE_SIGNALS, ...GATED_SIGNALS]) {
      expect(SIGNAL_SEVERITY[id], id).toBe("high");
    }
    for (const id of PAIR_SIGNALS) {
      expect(["high", "medium"], id).toContain(SIGNAL_SEVERITY[id]);
    }
    for (const id of [...STAND_ALONE_SIGNALS, ...GATED_SIGNALS, ...PAIR_SIGNALS]) {
      expect(SIGNAL_KIND[id], id).not.toBeNull();
      expect(BAD_DIRECTION[id], id).toBeDefined();
    }
    expect(badFlip(changed("sig.firewall", false, true))).toBe(true);
    expect(badFlip(changed("sig.firewall", true, false))).toBe(false);
    expect(badFlip(changed("sig.admin_count", 2, 1))).toBe(true);
    expect(badFlip(changed("sig.admin_count", 1, 2))).toBe(false);
    expect(badFlip(changed("sig.xprotect_version", 5300, 5311))).toBe(true);
    expect(badFlip(sig("sig.share_count", { value: 9, previous: 1, change: "changed" }))).toBe(true);
    expect(badFlip(sig("sig.share_count", { value: 1, previous: 9, change: "changed" }))).toBe(false);
    expect(badFlip(changed("sig.load_avg", 9, 1))).toBe(false);
    expect(GATED_SIGNALS).toEqual(["sig.firewall", "sig.remote_access_on", "sig.guest_share", "sig.autologin", "sig.admin_count", "sig.backup_auto", "sig.internet_sharing_on"]);
    expect(STAND_ALONE_SIGNALS).toEqual(["sig.sip", "sig.gatekeeper", "sig.xprotect_present", "sig.xprotect_scans_enabled", "sig.xprotect_version", "sig.hidden_user_count", "sig.authenticated_root", "sig.launch_label_masquerade_unsigned"]);
    expect(PAIR_SIGNALS).toHaveLength(18);
    expect(PAIR_SIGNALS.slice(10)).toEqual(["sig.shell_startup_changed", "sig.system_shell_files_count", "sig.paths_d_changed", "sig.app_new_unsigned", "sig.launch_label_masquerade", "sig.login_hook_set", "sig.dyld_insert_set", "sig.pam_auth_changed"]);
  });

  it("the severity totals are 32 high, 28 medium, 4 low and 3 info over 67 signals, 57 of them kinded", () => {
    expect(SIGNAL_IDS).toHaveLength(67);
    const totals = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const id of SIGNAL_IDS) totals[SIGNAL_SEVERITY[id]] += 1;
    expect(totals).toEqual({ critical: 0, high: 32, medium: 28, low: 4, info: 3 });
    expect(SIGNAL_IDS.filter((id) => SIGNAL_KIND[id] !== null)).toHaveLength(57);
  });

  it("badFlip any is true on changed only", () => {
    expect(BAD_DIRECTION["sig.authorized_keys_changed"]).toBe("any");
    for (const id of ["sig.shell_startup_changed", "sig.paths_d_changed", "sig.pam_auth_changed", "sig.authorized_keys_changed"] as const) {
      expect(BAD_DIRECTION[id], id).toBe("any");
      expect(badFlip(changed(id, "changed", null)), id).toBe(true);
      expect(badFlip(sig(id, { value: "same" })), id).toBe(false);
      expect(badFlip(sig(id, { value: "cleared", change: "cleared", minutesSinceChange: 1 })), id).toBe(false);
      expect(badFlip(changed(id, true, false)), id).toBe(false);
    }
    expect(badFlip(changed("sig.authenticated_root", false, true))).toBe(true);
    expect(badFlip(changed("sig.authenticated_root", true, false))).toBe(false);
    expect(badFlip(changed("sig.internet_sharing_on", true, false))).toBe(true);
    expect(badFlip(changed("sig.login_hook_set", true, false))).toBe(true);
    expect(badFlip(changed("sig.app_new_unsigned", 1, 0))).toBe(true);
    expect(badFlip(changed("sig.library_apps_count", 16, 17))).toBe(false);
  });

  it("every kinded boolean, count and version signal has a direction; the listing digests and the three untouched stat kinds have none", () => {
    const noRow: readonly SignalId[] = ["sig.persistence_set", "sig.listener_set", "sig.app_set", "sig.hosts_changed", "sig.sshd_config_changed", "sig.pam_sudo_changed"];
    for (const id of SIGNAL_IDS) {
      if (noRow.includes(id)) expect(BAD_DIRECTION[id], id).toBeUndefined();
      else if (SIGNAL_KIND[id] !== null) expect(BAD_DIRECTION[id], id).toBeDefined();
    }
    expect(badFlip(changed("sig.xprotect_remediator_version", 150, 149))).toBe(false);
    expect(badFlip(changed("sig.xprotect_remediator_version", 148, 149))).toBe(true);
    expect(badFlip(changed("sig.lockdown_mode", true, false))).toBe(false);
    expect(badFlip(changed("sig.lockdown_mode", false, true))).toBe(true);
    expect(badFlip(changed("sig.backup_destinations", 0, 1))).toBe(true);
    expect(badFlip(changed("sig.mdm_enrolled", true, false))).toBe(true);
    expect(topItems([changed("sig.xprotect_remediator_version", 150, 149)])).toEqual([]);
    expect(boundsFor([changed("sig.xprotect_remediator_version", 150, 149)]).floor).toBe("keep_an_eye");
  });

  it("the ten context-only signals have no kind", () => {
    const nulls = SIGNAL_IDS.filter((id) => SIGNAL_KIND[id] === null);
    expect(nulls).toEqual(["sig.established_count", "sig.resolvers", "sig.backup_age_days", "sig.load_avg", "sig.disk_free_pct", "sig.on_battery", "sig.pending_updates", "sig.broad_extension_count", "sig.app_new_unquarantined", "sig.library_apps_count"]);
  });

  it("the 67-signal context with 64 rules and 20 recent entries serialises under maxContextChars", () => {
    const c = CONTEXT_CASES.find((x) => x.name.startsWith("67 signals"));
    expect(c).toBeDefined();
    if (c === undefined) return;
    expect(c.expected.signals).toHaveLength(67);
    expect(c.expected.rules).toHaveLength(64);
    expect(c.expected.recent).toHaveLength(20);
    expect(WATCH_LIMITS.maxContextChars).toBe(22000);
    expect(JSON.stringify(c.expected).length).toBeLessThanOrEqual(WATCH_LIMITS.maxContextChars);
  });
});
