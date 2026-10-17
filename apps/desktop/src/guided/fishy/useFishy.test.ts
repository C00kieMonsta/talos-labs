import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FixOutcome, WatchDetails, WatchItem, WatchPlan, WatchPort, WatchState } from "@talos/core";
import type { Route, Router } from "../../app/router";
import { fakeAdapters } from "../../app/testing";
import { DEFAULT_SETTINGS } from "../../settings";
import type { WatchController } from "../../watch/watch-controller";
import { INERT_WATCH } from "../../watch/watch-controller";
import { EMPTY_WATCH_MEMORY } from "@talos/core";
import { NO_DISCONNECT_KINDS, choiceFor, detailsItemFor, isGatedKind, stagesFor, stopActionFor, useFishy } from "./useFishy";

afterEach(cleanup);

const GUIDED: Route = { name: "guided" };

const ITEM: WatchItem = {
  signalId: "sig.persistence_new",
  kind: "persistence",
  severity: "high",
  points: 6,
  change: "appeared",
  changedAt: "2026-10-17T13:32:00.000Z",
  gated: false,
  snoozedUntil: null,
  hasStartupEntry: true,
  isListener: false,
  actionIds: ["act.disconnect_network"],
  modelSentence: null,
  modelProvider: null,
};

const DETAILS: WatchDetails = {
  items: [{ signalId: "sig.persistence_new", plistPath: "/Users/me/Library/LaunchAgents/com.example.helper.plist", label: "com.example.helper", programPath: "/tmp/.helper", scope: "user_agent" }],
  wifiAvailable: true,
};

const PLAN: WatchPlan = { planId: "watch-plan-1", actionId: "watch.wifi_off", lines: [{ text: "/usr/sbin/networksetup -setairportpower en0 off", privilege: "admin" }], needsPassword: true, reversible: null, expiresAt: "2026-10-17T13:40:00.000Z" };

function state(items: readonly WatchItem[], licensed = true): WatchState {
  return { enabled: true, licensed, firstRun: false, hiddenLaunch: false, rating: items.length > 0 ? "act_now" : "calm", since: null, lastCheckAt: null, checking: false, cycleIndex: 3, everyMinutes: 60, notify: true, pausedUntil: null, closeWatchUntil: null, unavailable: [], gated: [], items, nextCheckAt: null, lastChangeAt: null, ai: { enabled: true, provider: null }, judge: null, recentCount: 0, rulesSince: null, report: null, next: null };
}

/** A watch port with only what the fishy flow touches; every other method rejects. */
function fakeWatchPort(overrides: Partial<WatchPort> = {}): WatchPort {
  const reject = vi.fn(async () => {
    throw "forbidden_window";
  });
  return {
    status: reject,
    checkNow: reject,
    pause: reject,
    setEnabled: reject,
    setInterval: reject,
    setNotify: reject,
    requestNotifyPermission: reject,
    setProfile: reject,
    acknowledge: reject,
    answerGate: reject,
    snooze: reject,
    context: reject,
    details: vi.fn(async () => DETAILS),
    openMain: reject,
    openSource: vi.fn(async () => undefined),
    actionPreview: vi.fn(async () => PLAN),
    actionApply: vi.fn(async (): Promise<FixOutcome> => ({ ok: true })),
    autostartEnable: reject,
    autostartDisable: reject,
    autostartIsEnabled: reject,
    onState: () => () => undefined,
    onNotified: () => () => undefined,
    onOpen: () => () => undefined,
    onShown: () => () => undefined,
    ...overrides,
  };
}

function fakeWatch(items: readonly WatchItem[] = [ITEM], overrides: Partial<WatchController> = {}): WatchController {
  return {
    ...INERT_WATCH,
    state: state(items),
    checkNow: vi.fn(),
    acknowledge: vi.fn(async () => undefined),
    answerGate: vi.fn(async () => undefined),
    notNow: vi.fn(async () => undefined),
    markFishyRan: vi.fn(),
    ...overrides,
  };
}

/** A router whose route the hook can read live; back() pops to the previous route. */
function fakeRouter(initial: Route): Router & { stack: Route[] } {
  const router = {
    stack: [initial],
    get route(): Route {
      return router.stack[router.stack.length - 1] as Route;
    },
    lastMove: "navigate" as const,
    navigate: vi.fn((route: Route) => {
      router.stack.push(route);
    }),
    back: vi.fn(() => {
      if (router.stack.length > 1) router.stack.pop();
    }),
    replace: vi.fn(),
  };
  return router;
}

function setup(input: { items?: readonly WatchItem[]; port?: Partial<WatchPort>; watch?: Partial<WatchController> } = {}) {
  const port = fakeWatchPort(input.port);
  const adapters = fakeAdapters({ watch: port });
  const watch = fakeWatch(input.items, input.watch);
  const router = fakeRouter(GUIDED);
  const hook = renderHook(() => useFishy({ watch, adapters, router, settings: DEFAULT_SETTINGS }));
  return { port, adapters, watch, router, hook };
}

describe("stagesFor and the choice helpers", () => {
  it("orders the screens by the item: the gate for a gated flip, stop for an entry or a listener, eradicate for persistence only", () => {
    expect(stagesFor(null)).toEqual(["noticed", "disconnect", "experts", "recover"]);
    expect(stagesFor(ITEM)).toEqual(["noticed", "disconnect", "stop", "eradicate", "experts", "recover"]);
    expect(stagesFor({ ...ITEM, kind: "listener", signalId: "sig.listener_new_ports", hasStartupEntry: false, isListener: true })).toEqual(["noticed", "disconnect", "stop", "experts", "recover"]);
    expect(stagesFor({ ...ITEM, kind: "remote", signalId: "sig.remote_access_on", gated: true, hasStartupEntry: false })).toEqual(["gate", "noticed", "disconnect", "experts", "recover"]);
    // A gated flag on a kind that has no gate sentence shows no gate.
    expect(stagesFor({ ...ITEM, gated: true, hasStartupEntry: false })).toEqual(["noticed", "disconnect", "eradicate", "experts", "recover"]);
  });

  it("the three new kinds: exposure is gated and skips the disconnect screen; app and shell take the four plain screens", () => {
    const exposure: WatchItem = { ...ITEM, kind: "exposure", signalId: "sig.internet_sharing_on", hasStartupEntry: false, gated: true };
    expect(stagesFor(exposure)).toEqual(["gate", "noticed", "experts", "recover"]);
    expect(stagesFor({ ...exposure, gated: false })).toEqual(["noticed", "experts", "recover"]);
    expect(stagesFor({ ...exposure, gated: false, signalId: "sig.airdrop_everyone" })).toEqual(["noticed", "experts", "recover"]);
    expect(stagesFor({ ...ITEM, kind: "app", signalId: "sig.app_new_unsigned", hasStartupEntry: false })).toEqual(["noticed", "disconnect", "experts", "recover"]);
    expect(stagesFor({ ...ITEM, kind: "shell", signalId: "sig.shell_startup_changed", hasStartupEntry: false })).toEqual(["noticed", "disconnect", "experts", "recover"]);
    // A gated flag on app or shell shows no gate: neither has a gate sentence.
    expect(stagesFor({ ...ITEM, kind: "app", signalId: "sig.app_new_unsigned", hasStartupEntry: false, gated: true })).toEqual(["noticed", "disconnect", "experts", "recover"]);
    expect(NO_DISCONNECT_KINDS).toEqual(["exposure"]);
    expect(isGatedKind("exposure")).toBe(true);
    expect(isGatedKind("app")).toBe(false);
    expect(isGatedKind("shell")).toBe(false);
  });

  it("leaves out a screen whose row was declined with Not now in the last 14 days, and brings it back after", () => {
    const now = "2026-10-17T12:00:00.000Z";
    const recent = { ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.disconnect_network": "2026-10-10T12:00:00.000Z" } };
    expect(stagesFor(ITEM, recent, now)).toEqual(["noticed", "stop", "eradicate", "experts", "recover"]);
    const old = { ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.disconnect_network": "2026-10-02T12:00:00.000Z" } };
    expect(stagesFor(ITEM, old, now)).toEqual(["noticed", "disconnect", "stop", "eradicate", "experts", "recover"]);
    const all = { ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.block_incoming": now, "act.stop_background_program": now, "act.review_background_programs": now, "act.reconnect_and_watch": now } };
    expect(stagesFor(ITEM, all, now)).toEqual(["noticed", "disconnect", "experts"]);
    expect(stagesFor(ITEM, all, now, true)).toEqual(["noticed", "experts"]);
    // A listener with no entry stops through the block row, so that row's decline drops its stop screen
    // and nothing else: on a Wi-Fi Mac the disconnect screen's own row is Wi-Fi off, never declined.
    const listener: WatchItem = { ...ITEM, signalId: "sig.listener_new_ports", kind: "listener", hasStartupEntry: false, isListener: true };
    expect(stagesFor(listener, { ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.block_incoming": now } }, now)).toEqual(["noticed", "disconnect", "experts", "recover"]);
    expect(stagesFor(listener, { ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.stop_background_program": now } }, now)).toEqual(["noticed", "disconnect", "stop", "experts", "recover"]);
    // On a wired Mac the disconnect screen carries the block row, so that decline drops both screens.
    expect(stagesFor(listener, { ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.block_incoming": now } }, now, true)).toEqual(["noticed", "experts", "recover"]);
    expect(stagesFor(ITEM, recent, now, true)).toEqual(["noticed", "disconnect", "stop", "eradicate", "experts", "recover"]);
  });

  it("binds the start-up entry's path to the two stop rows only, and picks the daemon row by scope", () => {
    const row = detailsItemFor(DETAILS, ITEM);
    expect(row?.plistPath).toBe(DETAILS.items[0]?.plistPath);
    expect(detailsItemFor(null, ITEM)).toBeNull();
    expect(detailsItemFor(DETAILS, null)).toBeNull();
    // A sibling row from the same listing binds; a row from another listing never does.
    expect(detailsItemFor({ items: [{ signalId: "sig.listener_set", port: 4444 }, { signalId: "sig.persistence_set", plistPath: "/Library/LaunchDaemons/x.plist", scope: "system_daemon" }], wifiAvailable: true }, ITEM)?.plistPath).toBe("/Library/LaunchDaemons/x.plist");
    expect(detailsItemFor({ items: [{ signalId: "sig.persistence_new", plistPath: "/Library/LaunchAgents/other.plist" }], wifiAvailable: true }, { ...ITEM, signalId: "sig.helper_tools_count" })).toBeNull();
    expect(choiceFor("watch.stop_user_agent", detailsItemFor({ items: [{ signalId: "sig.persistence_new", plistPath: "/Library/LaunchAgents/other.plist" }], wifiAvailable: true }, { ...ITEM, signalId: "sig.listener_new_ports", kind: "listener" }))).toEqual({ kind: "none" });
    expect(choiceFor("watch.stop_user_agent", row)).toEqual({ kind: "plist", path: DETAILS.items[0]?.plistPath });
    expect(choiceFor("watch.stop_daemon", null)).toEqual({ kind: "none" });
    expect(choiceFor("watch.wifi_off", row)).toEqual({ kind: "none" });
    expect(stopActionFor(row)).toBe("watch.stop_user_agent");
    expect(stopActionFor({ signalId: "sig.persistence_new", scope: "system_daemon", plistPath: "/Library/LaunchDaemons/x.plist" })).toBe("watch.stop_daemon");
    expect(stopActionFor(null)).toBe("watch.stop_user_agent");
  });
});

describe("useFishy", () => {
  it("open snapshots the top item, navigates to the fishy route with the start, and fetches details once on the noticed screen", async () => {
    const { hook, router, port } = setup();
    expect(hook.result.current.item).toBeNull();
    expect(port.details).not.toHaveBeenCalled();
    act(() => hook.result.current.open(GUIDED, "noticed"));
    expect(router.navigate).toHaveBeenCalledWith({ name: "fishy", returnTo: GUIDED, start: "noticed" });
    expect(hook.result.current.item).toEqual(ITEM);
    expect(hook.result.current.stage).toBe("noticed");
    await waitFor(() => expect(hook.result.current.details).toEqual(DETAILS));
    expect(port.details).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.next());
    expect(hook.result.current.stage).toBe("disconnect");
    expect(port.details).toHaveBeenCalledTimes(1);
    expect(hook.result.current.wired).toBe(false);
  });

  it("reads wired from details.wifiAvailable === false and holds the gate until it is answered", async () => {
    const gated: WatchItem = { ...ITEM, kind: "remote", signalId: "sig.remote_access_on", gated: true, hasStartupEntry: false };
    const { hook, port, watch, router } = setup({ items: [gated], port: { details: vi.fn(async () => ({ ...DETAILS, wifiAvailable: false })) } });
    act(() => hook.result.current.open(GUIDED));
    expect(router.navigate).toHaveBeenCalledWith({ name: "fishy", returnTo: GUIDED });
    expect(hook.result.current.stage).toBe("gate");
    // The details document is not read before the gate is answered.
    expect(port.details).not.toHaveBeenCalled();
    act(() => hook.result.current.answerGate(false));
    expect(watch.answerGate).toHaveBeenCalledWith("sig.remote_access_on", false);
    expect(hook.result.current.stage).toBe("noticed");
    await waitFor(() => expect(hook.result.current.wired).toBe(true));
    expect(router.back).not.toHaveBeenCalled();
  });

  it("recomputes the screens once Details says the Mac is wired, keeping the screen on show in place", async () => {
    const now = "2026-10-17T12:00:00.000Z";
    const listener: WatchItem = { ...ITEM, signalId: "sig.listener_new_ports", kind: "listener", hasStartupEntry: false, isListener: true };
    const memory = { ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.block_incoming": now } };
    const { hook } = setup({ items: [listener], watch: { memory }, port: { details: vi.fn(async () => ({ items: [], wifiAvailable: false })) } });
    act(() => hook.result.current.open(GUIDED));
    expect(hook.result.current.stage).toBe("noticed");
    await waitFor(() => expect(hook.result.current.wired).toBe(true));
    expect(hook.result.current.stage).toBe("noticed");
    // The wired disconnect screen carries the declined block row, so it is left out with the stop screen.
    act(() => hook.result.current.next());
    expect(hook.result.current.stage).toBe("experts");
    // On a Wi-Fi Mac the same decline leaves the disconnect screen in.
    const wifi = setup({ items: [listener], watch: { memory } });
    act(() => wifi.hook.result.current.open(GUIDED));
    await waitFor(() => expect(wifi.hook.result.current.details).not.toBeNull());
    act(() => wifi.hook.result.current.next());
    expect(wifi.hook.result.current.stage).toBe("disconnect");
  });

  it("Yes, that was me re-baselines through the controller and goes back", () => {
    const gated: WatchItem = { ...ITEM, kind: "guard", signalId: "sig.firewall", gated: true };
    const { hook, watch, router } = setup({ items: [gated] });
    act(() => hook.result.current.open(GUIDED));
    act(() => hook.result.current.answerGate(true));
    expect(watch.answerGate).toHaveBeenCalledWith("sig.firewall", true);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.route).toEqual(GUIDED);
  });

  it("This is fine calls watch.acknowledge and goes back; Not now calls watch.notNow with the action and the item, then goes back", () => {
    const { hook, watch, router } = setup();
    act(() => hook.result.current.open(GUIDED));
    act(() => hook.result.current.thisIsFine());
    expect(watch.acknowledge).toHaveBeenCalledWith("sig.persistence_new");
    expect(router.back).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.open(GUIDED));
    act(() => hook.result.current.next());
    act(() => hook.result.current.notNow("act.disconnect_network"));
    expect(watch.notNow).toHaveBeenCalledWith("act.disconnect_network", "sig.persistence_new");
    expect(router.back).toHaveBeenCalledTimes(2);
    expect(watch.markFishyRan).not.toHaveBeenCalled();
  });

  it("open honours actionNotNow for 14 days: the declined disconnect screen is skipped and the flow goes on to stop", async () => {
    const memory = { ...EMPTY_WATCH_MEMORY, actionNotNow: { "act.disconnect_network": "2026-10-16T12:00:00.000Z" } };
    const port = fakeWatchPort();
    const adapters = fakeAdapters({ watch: port });
    const watch = fakeWatch([ITEM], { memory });
    const router = fakeRouter(GUIDED);
    const hook = renderHook(() => useFishy({ watch, adapters, router, settings: DEFAULT_SETTINGS, now: () => "2026-10-17T12:00:00.000Z" }));
    act(() => hook.result.current.open(GUIDED));
    expect(hook.result.current.stage).toBe("noticed");
    act(() => hook.result.current.next());
    expect(hook.result.current.stage).toBe("stop");
    await waitFor(() => expect(port.details).toHaveBeenCalledTimes(1));
  });

  it("goes back only when the fishy route is current", () => {
    const { hook, router, watch } = setup();
    act(() => hook.result.current.thisIsFine());
    act(() => hook.result.current.done());
    act(() => hook.result.current.notNow("act.disconnect_network"));
    expect(router.back).not.toHaveBeenCalled();
    // Nothing was opened, so there is no item to acknowledge or snooze.
    expect(watch.acknowledge).not.toHaveBeenCalled();
    expect(watch.notNow).not.toHaveBeenCalled();
  });

  it("runAction previews with the plist choice for a stop row, applies with the password line, then moves on", async () => {
    const outcomes: FixOutcome[] = [{ ok: true }];
    const onProgressSeen: string[] = [];
    const port: Partial<WatchPort> = {
      actionPreview: vi.fn(async (actionId) => ({ ...PLAN, actionId, needsPassword: actionId !== "watch.stop_user_agent" })),
      actionApply: vi.fn(async (_planId, options): Promise<FixOutcome> => {
        options?.onProgress?.({ planId: PLAN.planId, phase: "running", step: 1, of: 1 });
        onProgressSeen.push("running");
        return outcomes.shift() ?? { ok: true };
      }),
    };
    const { hook, port: watchPort } = setup({ port });
    act(() => hook.result.current.open(GUIDED));
    await waitFor(() => expect(hook.result.current.details).toEqual(DETAILS));
    act(() => hook.result.current.next());
    act(() => hook.result.current.next());
    expect(hook.result.current.stage).toBe("stop");
    let run: Promise<void> = Promise.resolve();
    act(() => {
      run = hook.result.current.runAction("watch.stop_user_agent");
    });
    expect(hook.result.current.busy).toBe("working");
    await act(async () => run);
    expect(watchPort.actionPreview).toHaveBeenCalledWith("watch.stop_user_agent", { kind: "plist", path: DETAILS.items[0]?.plistPath });
    expect(watchPort.actionApply).toHaveBeenCalledWith(PLAN.planId, expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(onProgressSeen).toEqual(["running"]);
    expect(hook.result.current.busy).toBe("idle");
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.stage).toBe("eradicate");
  });

  it("an admin row shows the password line while macOS asks, and a failed apply keeps the screen with the error", async () => {
    let resolveApply: (outcome: FixOutcome) => void = () => undefined;
    const port: Partial<WatchPort> = {
      actionApply: vi.fn(() => new Promise<FixOutcome>((resolve) => (resolveApply = resolve))),
    };
    const { hook, port: watchPort } = setup({ port });
    act(() => hook.result.current.open(GUIDED));
    act(() => hook.result.current.next());
    let run: Promise<void> = Promise.resolve();
    act(() => {
      run = hook.result.current.runAction("watch.wifi_off");
    });
    await waitFor(() => expect(hook.result.current.busy).toBe("password"));
    expect(watchPort.actionPreview).toHaveBeenCalledWith("watch.wifi_off", { kind: "none" });
    act(() => resolveApply({ ok: false, error: "cancelled", step: null }));
    await act(async () => run);
    expect(hook.result.current.busy).toBe("idle");
    expect(hook.result.current.error).toBe("cancelled");
    expect(hook.result.current.stage).toBe("disconnect");
    // A rejected preview lands as a fix error too; unknown text becomes command_failed.
    watchPort.actionPreview = vi.fn(async () => {
      throw "not_in_catalog";
    });
    await act(async () => hook.result.current.runAction("watch.wifi_off"));
    expect(hook.result.current.error).toBe("not_in_catalog");
    watchPort.actionPreview = vi.fn(async () => {
      throw new Error("boom");
    });
    await act(async () => hook.result.current.runAction("watch.wifi_off"));
    expect(hook.result.current.error).toBe("command_failed");
  });

  it("the recover screen's action ends the flow: fishyRanAt is written and the route goes back", async () => {
    const { hook, watch, router } = setup({ items: [{ ...ITEM, kind: "dns", signalId: "sig.dns_manual", hasStartupEntry: false }] });
    act(() => hook.result.current.open(GUIDED));
    for (const stage of ["disconnect", "experts", "recover"]) {
      act(() => hook.result.current.next());
      expect(hook.result.current.stage).toBe(stage);
    }
    await act(async () => hook.result.current.runAction("watch.wifi_on"));
    expect(watch.markFishyRan).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("Not now on the last screen still records that the flow ran; next past the last screen is done", () => {
    const { hook, watch, router } = setup({ items: [{ ...ITEM, kind: "dns", signalId: "sig.dns_manual", hasStartupEntry: false }] });
    act(() => hook.result.current.open(GUIDED));
    act(() => hook.result.current.next());
    act(() => hook.result.current.next());
    act(() => hook.result.current.next());
    expect(hook.result.current.stage).toBe("recover");
    act(() => hook.result.current.notNow("act.reconnect_and_watch"));
    expect(watch.notNow).toHaveBeenCalledWith("act.reconnect_and_watch", "sig.dns_manual");
    expect(watch.markFishyRan).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.open(GUIDED));
    act(() => hook.result.current.next());
    act(() => hook.result.current.next());
    act(() => hook.result.current.next());
    act(() => hook.result.current.next());
    expect(watch.markFishyRan).toHaveBeenCalledTimes(2);
    expect(router.back).toHaveBeenCalledTimes(2);
  });

  it("showPane opens the pane then asks the watch to check now; reveal passes the bound plist path to the fix port by scope", async () => {
    const { hook, adapters, watch } = setup();
    act(() => hook.result.current.open(GUIDED));
    await waitFor(() => expect(hook.result.current.details).toEqual(DETAILS));
    act(() => hook.result.current.showPane("login_items"));
    expect(adapters.openSettingsPane).toHaveBeenCalledWith("login_items");
    expect(watch.checkNow).toHaveBeenCalledTimes(1);
    act(() => hook.result.current.reveal());
    expect(adapters.fixes.reveal).toHaveBeenCalledWith("TL-MAC-023", { kind: "plist", path: DETAILS.items[0]?.plistPath });
    act(() => hook.result.current.openSource("act.report"));
    expect(adapters.watch.openSource).toHaveBeenCalledWith("act.report");
  });

  it("reveal uses 024 for a system entry and does nothing without a path", async () => {
    const daemon: WatchDetails = { items: [{ signalId: "sig.persistence_new", plistPath: "/Library/LaunchDaemons/com.example.plist", scope: "system_daemon" }], wifiAvailable: true };
    const { hook, adapters } = setup({ port: { details: vi.fn(async () => daemon) } });
    act(() => hook.result.current.open(GUIDED));
    await waitFor(() => expect(hook.result.current.details).toEqual(daemon));
    act(() => hook.result.current.reveal());
    expect(adapters.fixes.reveal).toHaveBeenCalledWith("TL-MAC-024", { kind: "plist", path: "/Library/LaunchDaemons/com.example.plist" });
    cleanup();
    const none = setup({ port: { details: vi.fn(async () => ({ items: [], wifiAvailable: true })) } });
    act(() => none.hook.result.current.open(GUIDED));
    await waitFor(() => expect(none.hook.result.current.details).not.toBeNull());
    act(() => none.hook.result.current.reveal());
    expect(none.adapters.fixes.reveal).not.toHaveBeenCalled();
  });

  it("reveal uses 035 with the file choice for an app bundle row, and nothing for a changed shell file", async () => {
    const app: WatchItem = { ...ITEM, kind: "app", signalId: "sig.app_new_unsigned", hasStartupEntry: false };
    const bundle: WatchDetails = { items: [{ signalId: "sig.app_new_unsigned", label: "Helper.app", programPath: "/Applications/Helper.app", signature: "unsigned" }], wifiAvailable: true };
    const { hook, adapters } = setup({ items: [app], port: { details: vi.fn(async () => bundle) } });
    act(() => hook.result.current.open(GUIDED));
    await waitFor(() => expect(hook.result.current.details).toEqual(bundle));
    act(() => hook.result.current.reveal());
    expect(adapters.fixes.reveal).toHaveBeenCalledWith("TL-MAC-035", { kind: "file", path: "/Applications/Helper.app" });
    cleanup();
    const shell: WatchItem = { ...ITEM, kind: "shell", signalId: "sig.shell_startup_changed", hasStartupEntry: false };
    const file: WatchDetails = { items: [{ signalId: "sig.shell_startup_changed", filePath: "/Users/me/.zshrc" }], wifiAvailable: true };
    const none = setup({ items: [shell], port: { details: vi.fn(async () => file) } });
    act(() => none.hook.result.current.open(GUIDED));
    await waitFor(() => expect(none.hook.result.current.details).toEqual(file));
    act(() => none.hook.result.current.reveal());
    expect(none.adapters.fixes.reveal).not.toHaveBeenCalled();
  });

  it("opens with no item when the state reports licensed false, whatever items it carries", () => {
    const { hook } = setup({ watch: { state: state([ITEM], false) } });
    act(() => hook.result.current.open(GUIDED, "noticed"));
    expect(hook.result.current.item).toBeNull();
    expect(hook.result.current.stage).toBe("noticed");
  });

  it("opens with no item when the watch has none, and resets the ransom box and details on every open", async () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.open(GUIDED, "noticed"));
    expect(hook.result.current.item).toBeNull();
    expect(hook.result.current.stage).toBe("noticed");
    act(() => hook.result.current.setRansomNote(true));
    expect(hook.result.current.ransomNote).toBe(true);
    await waitFor(() => expect(hook.result.current.details).not.toBeNull());
    act(() => hook.result.current.open(GUIDED, "noticed"));
    expect(hook.result.current.ransomNote).toBe(false);
    expect(hook.result.current.details).toBeNull();
  });
});
