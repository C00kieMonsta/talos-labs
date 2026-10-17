import { describe, expect, it } from "vitest";
import type { Change, SignalId, WatchContext, WatchSignal } from "../../src/ports/watch-port";
import { ACTION_IDS, MODEL_PROBE_IDS, SIGNAL_IDS, SIGNAL_KIND } from "../../src/ports/watch-port";
import { RATE_CASES } from "../../src/watch/cases";
import { applyHysteresis, boundsFor, maxRating, minRating, rateWatch, topItems } from "../../src/watch/rate";
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
    for (const word of ["SIP", "Gatekeeper", "XProtect went missing", "XProtect scans", "version went down", "hidden account", "new listener", "PAC URL", "system extension", "cron line", "unanswered gate", "answered No"]) {
      expect(names).toContain(word);
    }
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

  it("every stand-alone, gated and pair signal is high and kinded, and has a bad direction", () => {
    for (const id of [...STAND_ALONE_SIGNALS, ...GATED_SIGNALS, ...PAIR_SIGNALS]) {
      expect(SIGNAL_SEVERITY[id], id).toBe("high");
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
    expect(GATED_SIGNALS).toEqual(["sig.firewall", "sig.remote_access_on", "sig.guest_share", "sig.autologin", "sig.admin_count", "sig.backup_auto"]);
    expect(STAND_ALONE_SIGNALS).toHaveLength(6);
    expect(PAIR_SIGNALS).toHaveLength(10);
  });

  it("every kinded boolean, count and version signal has a direction; the digest and stat kinds have none", () => {
    const noRow: readonly SignalId[] = ["sig.persistence_set", "sig.listener_set", "sig.hosts_changed", "sig.sshd_config_changed", "sig.pam_sudo_changed"];
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

  it("the eight context-only signals have no kind", () => {
    const nulls = SIGNAL_IDS.filter((id) => SIGNAL_KIND[id] === null);
    expect(nulls).toEqual(["sig.established_count", "sig.resolvers", "sig.backup_age_days", "sig.load_avg", "sig.disk_free_pct", "sig.on_battery", "sig.pending_updates", "sig.broad_extension_count"]);
  });
});
