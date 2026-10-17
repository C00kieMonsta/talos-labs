import { afterEach, describe, expect, it, vi } from "vitest";
import type { FishyKind, FixProgress, WatchState } from "@talos/core";
import { FISHY_KINDS, PLAYBOOK } from "@talos/core";
import type { WatchDemoFlags } from "../app/demo-boot";
import { DEFAULT_WATCH_DEMO } from "../app/demo-boot";
import { DEMO_WATCH_PLAN_TTL_MS, DemoWatch } from "./demo-watch";

const NOW = "2026-10-17T12:00:00.000Z";

/** The main window's fishy base carries licensed=1, so the tests start licensed unless they say otherwise. */
function flags(over: Partial<WatchDemoFlags> = {}): WatchDemoFlags {
  return { ...DEFAULT_WATCH_DEMO, licensed: true, ...over };
}

function make(over: Partial<WatchDemoFlags> = {}, now: () => string = () => NOW): DemoWatch {
  return new DemoWatch(flags(over), 0, now);
}

function kinds(): string[] {
  return (window.__talosDemoCalls ?? []).map((c) => c.kind);
}

afterEach(() => {
  delete window.__talosDemoCalls;
});

describe("DemoWatch per ?watch=", () => {
  it("absent: calm, enabled, not first run, no items, nothing unavailable", async () => {
    const state = await make().status();
    expect(state).toMatchObject({ enabled: true, firstRun: false, rating: "calm", checking: false, everyMinutes: 60, notify: true, items: [], unavailable: [], gated: [] });
    expect(state.lastCheckAt).not.toBeNull();
    expect(kinds()).toEqual([]);
  });

  it("calm, look, act, unreadable and first-run", async () => {
    expect(await make({ watch: "calm" }).status()).toMatchObject({ rating: "calm", items: [] });
    const look = await make({ watch: "look" }).status();
    expect(look.rating).toBe("keep_an_eye");
    expect(look.items.map((i) => i.signalId)).toEqual(["sig.persistence_new"]);
    const act = await make({ watch: "act" }).status();
    expect(act.rating).toBe("act_now");
    expect(act.items.map((i) => i.signalId)).toEqual(["sig.persistence_new", "sig.listener_new_ports"]);
    expect(act.items[0]).toMatchObject({ kind: "persistence", severity: "high", points: 6, hasStartupEntry: true, isListener: false, gated: false, snoozedUntil: null });
    const unreadable = await make({ watch: "unreadable" }).status();
    expect(unreadable.rating).toBe("calm");
    expect(unreadable.unavailable).toEqual([
      { probeId: "probe.listeners", reason: "permission_denied" },
      { probeId: "probe.remote_access", reason: "permission_denied" },
      { probeId: "probe.file_sharing", reason: "permission_denied" },
    ]);
    const first = await make({ watch: "first-run" }).status();
    expect(first).toMatchObject({ firstRun: true, rating: "calm", since: null, lastCheckAt: null, cycleIndex: 0, items: [] });
  });

  it("records watch:notified only when constructed with watch=act, no gate and a licence", async () => {
    make({ watch: "act" });
    expect(window.__talosDemoCalls).toEqual([{ kind: "watch:notified", arg: "sig.persistence_new" }]);
    delete window.__talosDemoCalls;
    make({ watch: "look" });
    make({ watch: "act", fishy: "remote", fishyGate: true });
    // Unlicensed, the state starts with licensed false and the items wait for the webview's push; Rust would never have notified.
    const unlicensed = await make({ watch: "act", licensed: false }).status();
    expect(unlicensed.licensed).toBe(false);
    expect(unlicensed.items.map((i) => i.signalId)).toEqual(["sig.persistence_new", "sig.listener_new_ports"]);
    expect(kinds()).toEqual([]);
  });
});

describe("DemoWatch per ?fishy=, ?fishyGate=, ?fishyWired=, ?watchAi=, ?ransomNote=", () => {
  it("fishy picks the top item kind and the headline signal for every kind, with the item's playbook actions", async () => {
    const expectedTop: Record<FishyKind, string> = {
      persistence: "sig.persistence_new",
      listener: "sig.listener_new_ports",
      guard: "sig.firewall",
      remote: "sig.remote_access_on",
      admin: "sig.admin_count",
      dns: "sig.dns_manual",
      backup: "sig.backup_auto",
    };
    for (const kind of FISHY_KINDS) {
      const port = make({ watch: "act", fishy: kind });
      const state = await port.status();
      const top = state.items[0];
      expect(top?.kind, kind).toBe(kind);
      expect(top?.signalId, kind).toBe(expectedTop[kind]);
      expect(top?.isListener, kind).toBe(kind === "listener");
      expect(top?.hasStartupEntry, kind).toBe(kind === "persistence");
      for (const id of top?.actionIds ?? []) {
        const row = PLAYBOOK.find((r) => r.id === id);
        expect(row?.triggers, `${kind} ${id}`).toContain(top?.signalId);
      }
      expect(port.fishyKind).toBe(kind);
    }
  });

  it("fishyGate puts the top item in gated; answering No lifts it and rates act now; Yes drops it", async () => {
    const port = make({ watch: "look", fishy: "remote", fishyGate: true });
    const state = await port.status();
    expect(state.gated).toEqual(["sig.remote_access_on"]);
    expect(state.items[0]?.gated).toBe(true);
    const seen: WatchState[] = [];
    port.onState((s) => seen.push(s));
    await port.answerGate("sig.remote_access_on", false);
    expect(seen.at(-1)).toMatchObject({ gated: [], rating: "act_now" });
    expect(seen.at(-1)?.items[0]?.gated).toBe(false);
    const mine = make({ watch: "look", fishy: "admin", fishyGate: true });
    await mine.answerGate("sig.admin_count", true);
    expect(await mine.status()).toMatchObject({ gated: [], rating: "calm", items: [] });
    expect(kinds()).toEqual(["watch_answer_gate", "watch_answer_gate"]);
  });

  it("fishyWired sets details.wifiAvailable false; details carry fixture text only for the kind's signal", async () => {
    expect((await make({ watch: "act", fishyWired: true }).details()).wifiAvailable).toBe(false);
    const details = await make({ watch: "act" }).details();
    expect(details.wifiAvailable).toBe(true);
    expect(details.items[0]).toMatchObject({ signalId: "sig.persistence_new", scope: "user_agent" });
    expect(details.items[0]?.plistPath).toMatch(/\.plist$/);
    expect(details.items[1]).toEqual({ signalId: "sig.listener_new_ports", port: 4444, processName: "helper" });
    const listener = await make({ watch: "act", fishy: "listener" }).details();
    expect(listener.items[0]).toEqual({ signalId: "sig.listener_new_ports", port: 4444, processName: "helper" });
  });

  it("watchAi picks the provider and the sentence; off, limit and absent give none; limit also gives no last verdict", async () => {
    const cases: [WatchDemoFlags["watchAi"], string | null, boolean][] = [
      ["apple", "apple", true],
      ["chatgpt", "chatgpt", true],
      ["claude", "claude_plan", true],
      ["off", null, false],
      ["limit", null, false],
      [null, null, false],
    ];
    for (const [ai, provider, verdict] of cases) {
      const port = make({ watch: "act", watchAi: ai });
      const top = (await port.status()).items[0];
      expect(top?.modelProvider, String(ai)).toBe(provider);
      expect(top?.modelSentence === null, String(ai)).toBe(provider === null);
      expect((await port.context()).lastVerdict === null, String(ai)).toBe(!verdict);
    }
  });

  it("the context is the model document: bounds from the signals, the four profile fields, the closed lists", async () => {
    const port = make({ watch: "act", fishy: "guard" });
    await port.setProfile({ role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false, extra: "x" } as never, undefined, true);
    const context = await port.context();
    expect(context).toMatchObject({ schemaVersion: 1, os: "macos", floor: "act_now", ceiling: "act_now", rules: [] });
    expect(context.profile).toEqual({ role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false });
    expect(context.signals.map((s) => s.signalId)).toEqual(["sig.firewall", "sig.gatekeeper"]);
    expect(context.recent).toHaveLength(2);
    expect(JSON.stringify(context)).not.toMatch(/\.plist|\/Users|helper/);
    expect((await make().context()).floor).toBe("calm");
  });

  it("a false push clears the items and flips licensed, and a true push leaves the items alone", async () => {
    const port = make({ watch: "act" });
    const states: WatchState[] = [];
    port.onState((s) => states.push(s));
    const before = await port.status();
    expect(before.licensed).toBe(true);
    expect(before.items.length).toBeGreaterThan(0);
    const profile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true } as const;
    await port.setProfile(profile, undefined, true);
    expect(await port.status()).toEqual(before);
    expect(states).toEqual([]);
    await port.setProfile(profile, undefined, false);
    const after = await port.status();
    expect(after).toMatchObject({ licensed: false, rating: "calm", items: [], gated: [], unavailable: [] });
    expect(states).toEqual([after]);
    await port.setProfile(profile, undefined, true);
    expect(await port.status()).toEqual({ ...after, licensed: true });
  });
});

describe("DemoWatch recorded calls", () => {
  it("records every call kind with ids, booleans and numbers only", async () => {
    const port = make({ watch: "act" });
    delete window.__talosDemoCalls;
    await port.checkNow();
    await port.pause(60);
    await port.setEnabled(false);
    await port.setInterval(15);
    await port.setNotify(false);
    await port.requestNotifyPermission();
    await port.setProfile({ role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true }, undefined, true);
    await port.snooze("sig.listener_new_ports");
    await port.acknowledge("sig.listener_new_ports");
    await port.openSource("act.report");
    const plan = await port.actionPreview("watch.wifi_off", { kind: "none" });
    expect(await port.actionApply(plan.planId)).toEqual({ ok: true });
    await port.autostartEnable();
    expect(await port.autostartIsEnabled()).toBe(true);
    await port.autostartDisable();
    expect(await port.autostartIsEnabled()).toBe(false);
    expect(window.__talosDemoCalls).toEqual([
      { kind: "watch_check_now" },
      { kind: "watch_pause", arg: 60 },
      { kind: "watch_set_enabled", arg: false },
      { kind: "watch_set_interval", arg: 15 },
      { kind: "watch_set_notify", arg: false },
      { kind: "watch_request_notify_permission" },
      { kind: "watch_set_profile", arg: true },
      { kind: "watch_snooze", arg: "sig.listener_new_ports" },
      { kind: "watch_acknowledge", arg: "sig.listener_new_ports" },
      { kind: "watch_open_source", arg: "act.report" },
      { kind: "watch_action_preview", arg: "watch.wifi_off" },
      { kind: "watch_action_apply", arg: "watch.wifi_off" },
      { kind: "autostart_enable" },
      { kind: "autostart_disable" },
    ]);
    expect(JSON.stringify(window.__talosDemoCalls)).not.toMatch(/https?:|\/Users|\.plist/);
    const state = await port.status();
    expect(state).toMatchObject({ enabled: false, everyMinutes: 15, notify: false, checking: false, cycleIndex: 5 });
    expect(state.pausedUntil).toBe("2026-10-17T13:00:00.000Z");
    expect(state.items.map((i) => i.signalId)).toEqual(["sig.persistence_new"]);
    expect(state.rating, "a lone new item no longer justifies act now").toBe("keep_an_eye");
  });

  it("snooze on the top item drops act now, sorts the item last and keeps it shown; acknowledging the last item lands on calm", async () => {
    const port = make({ watch: "act" });
    await port.snooze("sig.persistence_new");
    const after = await port.status();
    expect(after.rating).toBe("keep_an_eye");
    expect(after.items.map((i) => [i.signalId, i.snoozedUntil])).toEqual([
      ["sig.listener_new_ports", null],
      ["sig.persistence_new", "2026-10-31T12:00:00.000Z"],
    ]);
    await port.acknowledge("sig.listener_new_ports");
    expect((await port.status()).items.map((i) => i.signalId)).toEqual(["sig.persistence_new"]);
    await port.acknowledge("sig.persistence_new");
    expect(await port.status()).toMatchObject({ rating: "calm", items: [] });
  });

  it("snooze keeps act now only while an unsnoozed signal justifies it on its own", async () => {
    const port = make({ watch: "act", fishy: "guard" });
    await port.snooze("sig.firewall");
    expect((await port.status()).rating, "Gatekeeper off stands alone").toBe("act_now");
    expect((await port.status()).items.map((i) => i.signalId)).toEqual(["sig.gatekeeper", "sig.firewall"]);
    await port.snooze("sig.gatekeeper");
    expect((await port.status()).rating).toBe("keep_an_eye");
    expect((await port.status()).items.every((i) => i.snoozedUntil !== null)).toBe(true);
  });

  it("checkNow emits checking true then false through onState and clears firstRun", async () => {
    const port = make({ watch: "first-run" });
    const seen: boolean[] = [];
    const off = port.onState((s) => seen.push(s.checking));
    await port.checkNow();
    expect(seen).toEqual([true, false]);
    expect(await port.status()).toMatchObject({ firstRun: false, checking: false, cycleIndex: 1, lastCheckAt: NOW });
    off();
    await port.checkNow();
    expect(seen).toHaveLength(2);
  });

  it("openMain reaches onOpen listeners and records nothing", async () => {
    const port = make();
    const opened: string[] = [];
    const off = port.onOpen((e) => opened.push(e.screen));
    await port.openMain("settings_watch");
    off();
    await port.openMain("home");
    expect(opened).toEqual(["settings_watch"]);
    expect(kinds()).toEqual([]);
    expect(port.onNotified(() => undefined)()).toBe(true);
  });
});

describe("DemoWatch plans", () => {
  it("previews the six watch actions with the right choice, refuses the wrong one, and never a rule id", async () => {
    const port = make({ watch: "act" });
    const plist = "/Users/demo/Library/LaunchAgents/com.example.helper.plist";
    for (const id of ["watch.wifi_off", "watch.wifi_on", "watch.block_incoming", "watch.allow_incoming"] as const) {
      const plan = await port.actionPreview(id, { kind: "none" });
      expect(plan.actionId).toBe(id);
      expect(plan.needsPassword).toBe(true);
      expect(plan.lines[0]?.privilege).toBe("admin");
      expect(Date.parse(plan.expiresAt) - Date.parse(NOW)).toBe(DEMO_WATCH_PLAN_TTL_MS);
      await expect(port.actionPreview(id, { kind: "plist", path: plist })).rejects.toBe("invalid_choice");
    }
    const agent = await port.actionPreview("watch.stop_user_agent", { kind: "plist", path: plist });
    expect(agent.needsPassword).toBe(false);
    expect(agent.lines[0]?.text).toContain(plist);
    const daemon = await port.actionPreview("watch.stop_daemon", { kind: "plist", path: "/Library/LaunchDaemons/x.plist" });
    expect(daemon.needsPassword).toBe(true);
    await expect(port.actionPreview("watch.stop_daemon", { kind: "none" })).rejects.toBe("invalid_choice");
    await expect(port.actionPreview("TL-MAC-002" as never, { kind: "none" })).rejects.toBe("not_in_catalog");
    expect(JSON.stringify(window.__talosDemoCalls)).not.toMatch(/\.plist/);
  });

  it("apply reports progress, expires after five minutes, cancels on abort, and the recover actions close the watch", async () => {
    let now = Date.parse(NOW);
    const port = new DemoWatch(flags({ watch: "act" }), 0, () => new Date(now).toISOString());
    const plan = await port.actionPreview("watch.wifi_on", { kind: "none" });
    const seen: FixProgress[] = [];
    expect(await port.actionApply(plan.planId, { onProgress: (p) => seen.push(p) })).toEqual({ ok: true });
    expect(seen).toEqual([
      { planId: plan.planId, phase: "waiting_for_password", step: 1, of: 1 },
      { planId: plan.planId, phase: "running", step: 1, of: 1 },
    ]);
    expect(await port.status()).toMatchObject({ everyMinutes: 15, closeWatchUntil: "2026-10-18T12:00:00.000Z" });
    expect(await port.actionApply(plan.planId)).toEqual({ ok: false, error: "plan_expired", step: null });

    const stale = await port.actionPreview("watch.wifi_off", { kind: "none" });
    now += DEMO_WATCH_PLAN_TTL_MS;
    expect(await port.actionApply(stale.planId)).toEqual({ ok: false, error: "plan_expired", step: null });

    const slow = new DemoWatch(flags({ watch: "act" }), 50, () => new Date(now).toISOString());
    const cancelled = await slow.actionPreview("watch.block_incoming", { kind: "none" });
    const controller = new AbortController();
    const pending = slow.actionApply(cancelled.planId, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ ok: false, error: "cancelled", step: 1 });
    expect(kinds().filter((k) => k === "watch_action_apply")).toHaveLength(4);
    vi.restoreAllMocks();
  });
});
