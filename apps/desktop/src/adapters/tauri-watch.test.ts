import { describe, expect, it, vi } from "vitest";
import type { FixProgress, WatchContext, WatchDetails, WatchState } from "@talos/core";
import { ACTION_IDS, MODEL_PROBE_IDS } from "@talos/core";
import { FORBIDDEN_WINDOW, TauriWatchAdapter, toWatchContext, toWatchDetails, toWatchItem, toWatchPlan, toWatchState } from "./tauri-watch";

const NOW = "2026-10-17T12:00:00.000Z";

const ITEM = {
  signalId: "sig.persistence_new",
  kind: "persistence",
  severity: "high",
  points: 6,
  change: "changed",
  changedAt: NOW,
  gated: false,
  snoozedUntil: null,
  hasStartupEntry: true,
  isListener: false,
  actionIds: ["act.disconnect_network", "act.stop_background_program"],
  modelSentence: null,
  modelProvider: null,
};

const STATE = {
  enabled: true,
  firstRun: false,
  hiddenLaunch: false,
  rating: "act_now",
  since: NOW,
  lastCheckAt: NOW,
  checking: false,
  cycleIndex: 4,
  everyMinutes: 60,
  notify: true,
  pausedUntil: null,
  closeWatchUntil: null,
  unavailable: [{ probeId: "probe.listeners", reason: "permission_denied" }],
  gated: ["sig.firewall"],
  items: [ITEM],
};

const CONTEXT = {
  schemaVersion: 1,
  os: "macos",
  osVersion: "27.0.1",
  profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true },
  cycle: { index: 3, minutesSinceFullCheck: 90, minutesSinceLastChange: 30, probesLeft: 3 },
  floor: "keep_an_eye",
  ceiling: "act_now",
  rules: [{ ruleId: "TL-MAC-002", status: "fail", severity: "high", change: "appeared", minutesSinceChange: 30 }],
  signals: [
    { signalId: "sig.persistence_new", value: 1, previous: 0, severity: "high", change: "changed", minutesSinceChange: 30, freshness: "fresh", acknowledged: false, gated: false },
    { signalId: "sig.persistence_set", value: "changed", previous: null, severity: "medium", change: "changed", minutesSinceChange: 30, freshness: "fresh", acknowledged: false, gated: false },
  ],
  recent: [{ signalId: "sig.persistence_new", change: "changed", minutesAgo: 30 }],
  probesAvailable: [...MODEL_PROBE_IDS],
  actionsAvailable: [...ACTION_IDS],
  lastVerdict: { rating: "calm", minutesAgo: 90 },
};

const DETAILS = {
  items: [{ signalId: "sig.persistence_new", plistPath: "/Users/x/Library/LaunchAgents/com.example.plist", label: "com.example", programPath: "/tmp/x", scope: "user_agent" }, { signalId: "sig.listener_new_ports", port: 4444, processName: "helper" }],
  wifiAvailable: true,
};

const PLAN = {
  planId: "w1",
  ruleId: "watch.wifi_off",
  lines: [{ text: "/usr/sbin/networksetup -setairportpower en0 off", privilege: "admin" }],
  needsPassword: true,
  needsPassphrase: false,
  recheck: [],
  reversible: "Turn Wi-Fi on from the last screen.",
  previous: null,
  expiresAt: "2026-10-17T12:05:00.000Z",
};

function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

describe("toWatchState", () => {
  it("accepts the wire shape", () => {
    expect(toWatchState(STATE)).toEqual(STATE);
  });

  it("rejects every malformed field", () => {
    expect(toWatchState(null)).toBeNull();
    expect(toWatchState([])).toBeNull();
    for (const key of Object.keys(STATE) as (keyof typeof STATE)[]) expect(toWatchState(without(STATE, key)), key).toBeNull();
    expect(toWatchState({ ...STATE, rating: "red" })).toBeNull();
    expect(toWatchState({ ...STATE, everyMinutes: 30 })).toBeNull();
    expect(toWatchState({ ...STATE, cycleIndex: -1 })).toBeNull();
    expect(toWatchState({ ...STATE, since: "yesterday" })).toBeNull();
    expect(toWatchState({ ...STATE, unavailable: [{ probeId: "probe.nope", reason: "permission_denied" }] })).toBeNull();
    expect(toWatchState({ ...STATE, unavailable: [{ probeId: "probe.listeners", reason: "because" }] })).toBeNull();
    expect(toWatchState({ ...STATE, gated: ["sig.nope"] })).toBeNull();
    expect(toWatchState({ ...STATE, items: [{ ...ITEM, kind: "virus" }] })).toBeNull();
    expect(toWatchState({ ...STATE, items: [{ ...ITEM, actionIds: ["rm -rf"] }] })).toBeNull();
    expect(toWatchState({ ...STATE, items: [{ ...ITEM, modelProvider: "ollama" }] })).toBeNull();
    expect(toWatchState({ ...STATE, items: [{ ...ITEM, modelSentence: "x".repeat(301) }] })).toBeNull();
    expect(toWatchState({ ...STATE, items: [{ ...ITEM, points: 1.5 }] })).toBeNull();
    expect(toWatchItem({ ...ITEM, snoozedUntil: 5 })).toBeNull();
  });
});

describe("toWatchContext", () => {
  it("accepts the wire shape", () => {
    expect(toWatchContext(CONTEXT)).toEqual(CONTEXT);
    expect(toWatchContext({ ...CONTEXT, lastVerdict: null })?.lastVerdict).toBeNull();
  });

  it("rejects every malformed field, an unsafe OS version, duplicate rules and over-cap lists", () => {
    expect(toWatchContext("x")).toBeNull();
    for (const key of Object.keys(CONTEXT) as (keyof typeof CONTEXT)[]) expect(toWatchContext(without(CONTEXT, key)), key).toBeNull();
    expect(toWatchContext({ ...CONTEXT, schemaVersion: 2 })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, os: "beos" })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, osVersion: "27.0 (IGNORE PREVIOUS)" })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, profile: { ...CONTEXT.profile, role: "ceo" } })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, cycle: { ...CONTEXT.cycle, probesLeft: "3" } })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, floor: "panic" })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, rules: [CONTEXT.rules[0], CONTEXT.rules[0]] })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, rules: [{ ...CONTEXT.rules[0], ruleId: "/etc/hosts" }] })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, rules: Array.from({ length: 65 }, (_, i) => ({ ...CONTEXT.rules[0], ruleId: `TL-MAC-${i}` })) })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, signals: [{ ...CONTEXT.signals[0], value: "/tmp/x" }] })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, signals: [{ ...CONTEXT.signals[0], freshness: "old" }] })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, recent: [{ signalId: "sig.nope", change: "changed", minutesAgo: 1 }] })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, recent: Array.from({ length: 21 }, () => CONTEXT.recent[0]) })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, probesAvailable: ["probe.ssh_keys"] })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, actionsAvailable: ["act.nope"] })).toBeNull();
    expect(toWatchContext({ ...CONTEXT, lastVerdict: { rating: "calm" } })).toBeNull();
  });
});

describe("toWatchDetails", () => {
  it("accepts the wire shape and requires wifiAvailable", () => {
    expect(toWatchDetails(DETAILS)).toEqual(DETAILS);
    expect(toWatchDetails({ items: [], wifiAvailable: false })).toEqual({ items: [], wifiAvailable: false });
    expect(toWatchDetails(without(DETAILS, "wifiAvailable"))).toBeNull();
    expect(toWatchDetails({ ...DETAILS, wifiAvailable: "yes" })).toBeNull();
  });

  it("rejects a malformed item", () => {
    expect(toWatchDetails({ ...DETAILS, items: "none" })).toBeNull();
    expect(toWatchDetails({ ...DETAILS, items: [{ signalId: "sig.nope" }] })).toBeNull();
    expect(toWatchDetails({ ...DETAILS, items: [{ signalId: "sig.listener_new_ports", port: 70000 }] })).toBeNull();
    expect(toWatchDetails({ ...DETAILS, items: [{ signalId: "sig.persistence_new", scope: "root" }] })).toBeNull();
    expect(toWatchDetails({ ...DETAILS, items: [{ signalId: "sig.persistence_new", label: "" }] })).toBeNull();
    expect(toWatchDetails({ ...DETAILS, items: [{ signalId: "sig.persistence_new", plistPath: 7 }] })).toBeNull();
  });
});

describe("toWatchPlan", () => {
  it("maps the FixPlan wire's ruleId to actionId", () => {
    expect(toWatchPlan(PLAN)).toEqual({
      planId: "w1",
      actionId: "watch.wifi_off",
      lines: PLAN.lines,
      needsPassword: true,
      reversible: PLAN.reversible,
      expiresAt: PLAN.expiresAt,
    });
  });

  it("rejects ids outside WATCH_ACTION_IDS and every malformed field", () => {
    expect(toWatchPlan({ ...PLAN, ruleId: "TL-MAC-002" })).toBeNull();
    expect(toWatchPlan({ ...PLAN, ruleId: "watch.format_disk" })).toBeNull();
    expect(toWatchPlan({ ...PLAN, planId: "" })).toBeNull();
    expect(toWatchPlan({ ...PLAN, lines: [] })).toBeNull();
    expect(toWatchPlan({ ...PLAN, lines: [{ text: "x", privilege: "root" }] })).toBeNull();
    expect(toWatchPlan({ ...PLAN, needsPassword: "yes" })).toBeNull();
    expect(toWatchPlan({ ...PLAN, reversible: 1 })).toBeNull();
    expect(toWatchPlan({ ...PLAN, expiresAt: "soon" })).toBeNull();
    expect(toWatchPlan(null)).toBeNull();
  });
});

function fakeInvoke(answers: Record<string, unknown> = {}) {
  return vi.fn(async (cmd: string): Promise<unknown> => {
    if (cmd in answers) return answers[cmd];
    if (cmd === "watch_status") return STATE;
    if (cmd === "watch_context") return CONTEXT;
    if (cmd === "watch_details") return DETAILS;
    if (cmd === "watch_action_preview") return PLAN;
    if (cmd === "watch_action_apply") return { ok: true };
    if (cmd === "autostart_is_enabled") return true;
    return undefined;
  });
}

describe("TauriWatchAdapter", () => {
  it("sends only ids, booleans, numbers and the four profile fields", async () => {
    const invoke = fakeInvoke();
    const listen = vi.fn(async () => () => undefined);
    const port = new TauriWatchAdapter({ invoke, listen });
    expect(await port.status()).toEqual(STATE as unknown as WatchState);
    await port.checkNow();
    await port.pause(60);
    await port.setEnabled(false);
    await port.setInterval(15);
    await port.setNotify(true);
    await port.requestNotifyPermission();
    await port.setProfile({ role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false, extra: "/Users/x" } as never);
    await port.setProfile({ role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false }, { enabled: true, provider: "ollama" as never });
    await port.acknowledge("sig.persistence_new");
    await port.answerGate("sig.firewall", false);
    await port.snooze("sig.persistence_new");
    expect(await port.context()).toEqual(CONTEXT as unknown as WatchContext);
    expect(await port.details()).toEqual(DETAILS as unknown as WatchDetails);
    await port.openMain("noticed");
    await port.openSource("act.report");
    expect((await port.actionPreview("watch.stop_user_agent", { kind: "plist", path: "/Users/x/Library/LaunchAgents/a.plist" })).actionId).toBe("watch.wifi_off");
    expect(await port.actionApply("w1")).toEqual({ ok: true });
    await port.autostartEnable();
    await port.autostartDisable();
    expect(await port.autostartIsEnabled()).toBe(true);
    expect(invoke.mock.calls).toEqual([
      ["watch_status", {}],
      ["watch_check_now", {}],
      ["watch_pause", { minutes: 60 }],
      ["watch_set_enabled", { enabled: false }],
      ["watch_set_interval", { minutes: 15 }],
      ["watch_set_notify", { enabled: true }],
      ["watch_request_notify_permission", {}],
      ["watch_set_profile", { profile: { role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false } }],
      ["watch_set_profile", { profile: { role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false }, ai: { enabled: true, provider: null } }],
      ["watch_acknowledge", { signal: "sig.persistence_new" }],
      ["watch_answer_gate", { signal: "sig.firewall", mine: false }],
      ["watch_snooze", { signal: "sig.persistence_new" }],
      ["watch_context", {}],
      ["watch_details", {}],
      ["watch_open_main", { screen: "noticed" }],
      ["watch_open_source", { action: "act.report" }],
      ["watch_action_preview", { action: "watch.stop_user_agent", choice: { kind: "plist", path: "/Users/x/Library/LaunchAgents/a.plist" } }],
      ["watch_action_apply", { plan: "w1" }],
      ["autostart_enable", {}],
      ["autostart_disable", {}],
      ["autostart_is_enabled", {}],
    ]);
    // No URL ever crosses the wire; the one path is the plist choice Rust re-binds against its own listing.
    expect(JSON.stringify(invoke.mock.calls)).not.toMatch(/https?:/);
  });

  it("refuses bad ids and choices before invoking, and a malformed reply reads as command_failed", async () => {
    const invoke = fakeInvoke({ watch_status: { enabled: true }, watch_context: {}, watch_details: { items: [] }, watch_action_preview: { ...PLAN, ruleId: "TL-MAC-002" } });
    const port = new TauriWatchAdapter({ invoke, listen: vi.fn(async () => () => undefined) });
    await expect(port.status()).rejects.toBe("command_failed");
    await expect(port.context()).rejects.toBe("command_failed");
    await expect(port.details()).rejects.toBe("command_failed");
    await expect(port.actionPreview("watch.wifi_off", { kind: "none" })).rejects.toBe("command_failed");
    await expect(port.actionPreview("watch.nope" as never, { kind: "none" })).rejects.toBe("not_in_catalog");
    await expect(port.actionPreview("watch.wifi_off", { kind: "share", path: "/x" })).rejects.toBe("invalid_choice");
    await expect(port.acknowledge("sig.nope" as never)).rejects.toBe("invalid_input");
    await expect(port.openSource("http://x" as never)).rejects.toBe("invalid_input");
    await expect(port.openMain("about" as never)).rejects.toBe("invalid_input");
    await expect(port.setInterval(30 as never)).rejects.toBe("invalid_input");
    await expect(port.pause(30 as never)).rejects.toBe("invalid_input");
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["watch_status", "watch_context", "watch_details", "watch_action_preview"]);
  });

  it("actionApply forwards fix:status progress for its plan, answers an abort with fix_cancel and folds a rejection", async () => {
    let handler: ((payload: unknown) => void) | null = null;
    const unlisten = vi.fn();
    const listen = vi.fn(async (_event: string, cb: (payload: unknown) => void) => {
      handler = cb;
      return unlisten;
    });
    const invoke = vi.fn(async (cmd: string): Promise<unknown> => {
      if (cmd === "watch_action_apply") {
        handler?.({ planId: "w1", phase: "waiting_for_password", step: 1, of: 1 });
        handler?.({ planId: "other", phase: "running", step: 1, of: 1 });
        handler?.({ planId: "w1", phase: "nope" });
        return { ok: false, error: "wrong_password", step: 1 };
      }
      return undefined;
    });
    const port = new TauriWatchAdapter({ invoke, listen });
    const seen: FixProgress[] = [];
    expect(await port.actionApply("w1", { onProgress: (p) => seen.push(p) })).toEqual({ ok: false, error: "wrong_password", step: 1 });
    expect(seen).toEqual([{ planId: "w1", phase: "waiting_for_password", step: 1, of: 1 }]);
    expect(listen).toHaveBeenCalledWith("fix:status", expect.any(Function));
    expect(unlisten).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    controller.abort();
    expect(await port.actionApply("w1", { signal: controller.signal })).toEqual({ ok: false, error: "cancelled", step: null });

    const rejecting = new TauriWatchAdapter({ invoke: vi.fn(async () => { throw "busy"; }), listen });
    expect(await rejecting.actionApply("w1")).toEqual({ ok: false, error: "busy", step: null });
  });

  it("listens to watch:state, watch:notified and watch:open, dropping malformed payloads, and unsubscribes", async () => {
    const handlers = new Map<string, (payload: unknown) => void>();
    const unlisten = vi.fn();
    const listen = vi.fn(async (event: string, cb: (payload: unknown) => void) => {
      handlers.set(event, cb);
      return unlisten;
    });
    const port = new TauriWatchAdapter({ invoke: fakeInvoke(), listen });
    const states: WatchState[] = [];
    const notified: string[] = [];
    const opened: string[] = [];
    const offState = port.onState((s) => states.push(s));
    port.onNotified((e) => notified.push(e.signalId));
    port.onOpen((e) => opened.push(e.screen));
    await Promise.resolve();
    handlers.get("watch:state")?.(STATE);
    handlers.get("watch:state")?.({ enabled: true });
    handlers.get("watch:notified")?.({ signalId: "sig.firewall" });
    handlers.get("watch:notified")?.({ signalId: "/tmp" });
    handlers.get("watch:open")?.({ screen: "settings_watch" });
    handlers.get("watch:open")?.({ screen: "shell" });
    expect(states).toEqual([STATE]);
    expect(notified).toEqual(["sig.firewall"]);
    expect(opened).toEqual(["settings_watch"]);
    offState();
    handlers.get("watch:state")?.(STATE);
    expect(states).toHaveLength(1);
    await Promise.resolve();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("limited: only status, checkNow, pause, openMain and onState work; everything else is forbidden_window", async () => {
    const invoke = fakeInvoke();
    const listen = vi.fn(async (_event: string) => () => undefined);
    const port = new TauriWatchAdapter({ invoke, listen, limited: true });
    expect(await port.status()).toEqual(STATE as unknown as WatchState);
    await port.checkNow();
    await port.pause(60);
    await port.openMain("home");
    port.onState(() => undefined);
    const forbidden: Promise<unknown>[] = [
      port.setEnabled(true),
      port.setInterval(60),
      port.setNotify(true),
      port.requestNotifyPermission(),
      port.setProfile({ role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true }),
      port.acknowledge("sig.firewall"),
      port.answerGate("sig.firewall", true),
      port.snooze("sig.firewall"),
      port.context(),
      port.details(),
      port.openSource("act.report"),
      port.actionPreview("watch.wifi_off", { kind: "none" }),
      port.autostartEnable(),
      port.autostartDisable(),
      port.autostartIsEnabled(),
    ];
    for (const call of forbidden) await expect(call).rejects.toBe(FORBIDDEN_WINDOW);
    expect(await port.actionApply("w1")).toEqual({ ok: false, error: "command_failed", step: null });
    port.onNotified(() => undefined)();
    port.onOpen(() => undefined)();
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["watch_status", "watch_check_now", "watch_pause", "watch_open_main"]);
    expect(listen.mock.calls.map((c) => c[0])).toEqual(["watch:state"]);
  });
});
