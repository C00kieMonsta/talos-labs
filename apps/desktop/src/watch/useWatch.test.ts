import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ExplainerProfile, WatchMemory, WatchPort, WatchState } from "@talos/core";
import { EMPTY_WATCH_MEMORY, isMuted } from "@talos/core";
import { fakeWatchPort, fakeWatchState } from "../app/testing";
import { DEFAULT_SETTINGS } from "../settings";
import type { WatchSettings } from "../settings";
import { snoozeTargets, useWatch, useWatchStatus } from "./useWatch";
import type { WatchDeps } from "./useWatch";

const NOW = "2026-10-17T12:00:00.000Z";
const PROFILE: ExplainerProfile = DEFAULT_SETTINGS.profile;

function flush(): Promise<void> {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface Harness {
  readonly port: WatchPort;
  readonly updateSettings: ReturnType<typeof vi.fn>;
  readonly saveMemory: ReturnType<typeof vi.fn>;
  readonly hook: ReturnType<typeof renderHook<ReturnType<typeof useWatch>, Partial<WatchDeps>>>;
  emit(state: WatchState): void;
}

function mount(options: { state?: WatchState; settings?: Partial<WatchSettings>; memory?: WatchMemory; port?: Partial<WatchPort>; autostart?: boolean; licensed?: boolean | null } = {}): Harness {
  let listener: ((state: WatchState) => void) | null = null;
  const port = fakeWatchPort(
    {
      onState: vi.fn((cb: (state: WatchState) => void) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
      autostartIsEnabled: vi.fn(async () => options.autostart ?? false),
      ...options.port,
    },
    options.state ?? fakeWatchState(),
  );
  const updateSettings = vi.fn();
  const saveMemory = vi.fn();
  const base: WatchDeps = {
    port,
    settings: { ...DEFAULT_SETTINGS.watch, ...options.settings },
    profile: PROFILE,
    licensed: options.licensed === undefined ? true : options.licensed,
    updateSettings,
    memory: options.memory ?? EMPTY_WATCH_MEMORY,
    saveMemory,
    now: () => NOW,
  };
  const hook = renderHook((over: Partial<WatchDeps> = {}) => useWatch({ ...base, ...over }));
  return {
    port,
    updateSettings,
    saveMemory,
    hook,
    emit: (state) => act(() => listener?.(state)),
  };
}

afterEach(() => {
  cleanup();
});

describe("useWatch on mount", () => {
  it("reads status() and autostartIsEnabled() and writes the four keys back into settings when they differ", async () => {
    const state = fakeWatchState({ enabled: false, everyMinutes: 240, notify: false });
    const h = mount({ state, autostart: true, settings: { enabled: true, everyMinutes: 60, notify: true, startAtLogin: false } });
    await flush();
    expect(h.port.status).toHaveBeenCalledTimes(1);
    expect(h.port.autostartIsEnabled).toHaveBeenCalledTimes(1);
    expect(h.updateSettings).toHaveBeenCalledWith({ enabled: false, everyMinutes: 240, notify: false });
    expect(h.updateSettings).toHaveBeenCalledWith({ startAtLogin: true });
    expect(h.hook.result.current.state).toEqual(state);
    expect(h.hook.result.current.startAtLogin).toBe(true);
  });

  it("writes nothing when settings already match, and never calls setEnabled, setInterval, setNotify or requestNotifyPermission", async () => {
    const h = mount();
    await flush();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.port.setEnabled).not.toHaveBeenCalled();
    expect(h.port.setInterval).not.toHaveBeenCalled();
    expect(h.port.setNotify).not.toHaveBeenCalled();
    expect(h.port.requestNotifyPermission).not.toHaveBeenCalled();
    expect(h.port.autostartEnable).not.toHaveBeenCalled();
    expect(h.port.autostartDisable).not.toHaveBeenCalled();
  });

  it("pushes setProfile once on mount, again when a profile field changes, and not on an unrelated re-render", async () => {
    const h = mount();
    await flush();
    expect(h.port.setProfile).toHaveBeenCalledTimes(1);
    expect(h.port.setProfile).toHaveBeenCalledWith(PROFILE, undefined, true);
    h.hook.rerender({ settings: { ...DEFAULT_SETTINGS.watch, everyMinutes: 15 } });
    await flush();
    expect(h.port.setProfile).toHaveBeenCalledTimes(1);
    const changed: ExplainerProfile = { ...PROFILE, handlesClientData: true };
    h.hook.rerender({ profile: changed });
    await flush();
    expect(h.port.setProfile).toHaveBeenCalledTimes(2);
    expect(h.port.setProfile).toHaveBeenLastCalledWith(changed, undefined, true);
    expect(h.port.setEnabled).not.toHaveBeenCalled();
    expect(h.port.setNotify).not.toHaveBeenCalled();
  });

  it("sends the AI switch and provider beside the profile when given, and again when they change", async () => {
    const h = mount();
    h.hook.rerender({ ai: { enabled: true, provider: "chatgpt" } });
    await flush();
    expect(h.port.setProfile).toHaveBeenLastCalledWith(PROFILE, { enabled: true, provider: "chatgpt" }, true);
    h.hook.rerender({ ai: { enabled: true, provider: "chatgpt" } });
    await flush();
    expect(h.port.setProfile).toHaveBeenCalledTimes(2);
    h.hook.rerender({ ai: { enabled: false, provider: null } });
    await flush();
    expect(h.port.setProfile).toHaveBeenCalledTimes(3);
    expect(h.port.setProfile).toHaveBeenLastCalledWith(PROFILE, { enabled: false, provider: null }, true);
  });

  it("does not push while the licence is unread, pushes once it resolves, and again when it flips", async () => {
    const h = mount({ licensed: null });
    await flush();
    expect(h.port.setProfile).not.toHaveBeenCalled();
    h.hook.rerender({ licensed: true });
    await flush();
    expect(h.port.setProfile).toHaveBeenCalledTimes(1);
    expect(h.port.setProfile).toHaveBeenLastCalledWith(PROFILE, undefined, true);
    h.hook.rerender({ licensed: false });
    await flush();
    expect(h.port.setProfile).toHaveBeenCalledTimes(2);
    expect(h.port.setProfile).toHaveBeenLastCalledWith(PROFILE, undefined, false);
  });

  it("a watch:state with licensed false clears the startAtLogin cache and patches settings", async () => {
    const h = mount({ autostart: true, settings: { startAtLogin: true } });
    await flush();
    expect(h.hook.result.current.startAtLogin).toBe(true);
    h.updateSettings.mockClear();
    h.emit(fakeWatchState({ licensed: false }));
    expect(h.hook.result.current.startAtLogin).toBe(false);
    expect(h.updateSettings).toHaveBeenCalledWith({ startAtLogin: false });
    expect(h.port.autostartDisable).not.toHaveBeenCalled();
    h.updateSettings.mockClear();
    h.emit(fakeWatchState({ licensed: false }));
    h.hook.rerender({ settings: { ...DEFAULT_SETTINGS.watch, startAtLogin: false } });
    h.emit(fakeWatchState({ licensed: false }));
    expect(h.updateSettings).toHaveBeenLastCalledWith({ startAtLogin: false });
  });

  it("requestNotifyPermission records notifyAskedAt once the port answers, and not on a rejection", async () => {
    const h = mount();
    await flush();
    await act(() => h.hook.result.current.requestNotifyPermission());
    expect(h.port.requestNotifyPermission).toHaveBeenCalledTimes(1);
    expect(h.saveMemory).toHaveBeenCalledTimes(1);
    expect(h.saveMemory).toHaveBeenCalledWith({ ...EMPTY_WATCH_MEMORY, notifyAskedAt: NOW });
    const rejecting = mount({ port: { requestNotifyPermission: vi.fn(async () => { throw "denied"; }) } });
    await flush();
    await act(() => rejecting.hook.result.current.requestNotifyPermission());
    expect(rejecting.saveMemory).not.toHaveBeenCalled();
  });

  it("follows watch:state and reconciles each one, and survives a failing status()", async () => {
    const h = mount();
    await flush();
    h.emit(fakeWatchState({ rating: "act_now", notify: false }));
    expect(h.hook.result.current.state?.rating).toBe("act_now");
    expect(h.updateSettings).toHaveBeenLastCalledWith({ notify: false });
    const failing = mount({ port: { status: vi.fn(async () => { throw "forbidden_window"; }), autostartIsEnabled: vi.fn(async () => { throw "boom"; }) } });
    await flush();
    expect(failing.hook.result.current.state).toBeNull();
    expect(failing.hook.result.current.startAtLogin).toBeNull();
    expect(failing.updateSettings).not.toHaveBeenCalled();
  });
});

describe("useWatch setters", () => {
  it("each calls the port once, then writes the key; a rejection leaves settings alone", async () => {
    const h = mount();
    await flush();
    h.updateSettings.mockClear();
    await act(() => h.hook.result.current.setEnabled(false));
    await act(() => h.hook.result.current.setInterval(15));
    await act(() => h.hook.result.current.setNotify(false));
    await act(() => h.hook.result.current.setStartAtLogin(true));
    await act(() => h.hook.result.current.requestNotifyPermission());
    expect(h.port.setEnabled).toHaveBeenCalledTimes(1);
    expect(h.port.setEnabled).toHaveBeenCalledWith(false);
    expect(h.port.setInterval).toHaveBeenCalledTimes(1);
    expect(h.port.setInterval).toHaveBeenCalledWith(15);
    expect(h.port.setNotify).toHaveBeenCalledTimes(1);
    expect(h.port.setNotify).toHaveBeenCalledWith(false);
    expect(h.port.autostartEnable).toHaveBeenCalledTimes(1);
    expect(h.port.requestNotifyPermission).toHaveBeenCalledTimes(1);
    expect(h.updateSettings.mock.calls).toEqual([[{ enabled: false, startAtLogin: false }], [{ everyMinutes: 15 }], [{ notify: false }], [{ startAtLogin: true }]]);
    expect(h.hook.result.current.startAtLogin).toBe(true);
    await act(() => h.hook.result.current.setStartAtLogin(false));
    expect(h.port.autostartDisable).toHaveBeenCalledTimes(1);
    expect(h.hook.result.current.startAtLogin).toBe(false);

    const rejecting = mount({ port: { setEnabled: vi.fn(async () => { throw "busy"; }), autostartEnable: vi.fn(async () => { throw "busy"; }) } });
    await flush();
    await act(() => rejecting.hook.result.current.setEnabled(false));
    await act(() => rejecting.hook.result.current.setStartAtLogin(true));
    expect(rejecting.updateSettings).not.toHaveBeenCalled();
    expect(rejecting.hook.result.current.startAtLogin).toBe(false);
  });

  it("checkNow, pause and openSource reach the port with ids only", async () => {
    const h = mount();
    await flush();
    act(() => h.hook.result.current.checkNow());
    act(() => h.hook.result.current.pause());
    act(() => h.hook.result.current.openSource("act.report"));
    expect(h.port.checkNow).toHaveBeenCalledTimes(1);
    expect(h.port.pause).toHaveBeenCalledWith(60);
    expect(h.port.openSource).toHaveBeenCalledWith("act.report");
  });
});

describe("useWatch memory", () => {
  it("acknowledge writes normalForMe and the count, and three in a row mute the signal", async () => {
    let memory: WatchMemory = EMPTY_WATCH_MEMORY;
    const h = mount({ port: {}, memory });
    await flush();
    for (let i = 1; i <= 3; i += 1) {
      h.hook.rerender({ memory });
      await act(() => h.hook.result.current.acknowledge("sig.share_count"));
      memory = h.saveMemory.mock.lastCall?.[0] as WatchMemory;
      expect(memory.normalForMe["sig.share_count"]).toBe(NOW);
      expect(memory.acknowledgeCount["sig.share_count"]).toBe(i);
      expect(isMuted(memory, "sig.share_count")).toBe(i >= 3);
    }
    expect(h.port.acknowledge).toHaveBeenCalledTimes(3);
    expect(h.port.acknowledge).toHaveBeenCalledWith("sig.share_count");
  });

  it("notNow writes actionNotNow and a 14-day snooze and calls port.snooze", async () => {
    const h = mount();
    await flush();
    await act(() => h.hook.result.current.notNow("act.disconnect_network", "sig.persistence_new"));
    expect(h.saveMemory).toHaveBeenCalledWith({
      ...EMPTY_WATCH_MEMORY,
      actionNotNow: { "act.disconnect_network": NOW },
      snoozedSignals: { "sig.persistence_new": "2026-10-31T12:00:00.000Z" },
    });
    expect(h.port.snooze).toHaveBeenCalledWith("sig.persistence_new");
    expect(h.port.snooze).toHaveBeenCalledTimes(1);
    expect(h.port.setEnabled).not.toHaveBeenCalled();
  });

  it("notNow on an act-now state snoozes every item that justifies it, skipping gated and already snoozed ones", async () => {
    const item = (signalId: WatchState["items"][number]["signalId"], over: Partial<WatchState["items"][number]> = {}): WatchState["items"][number] => ({
      signalId,
      kind: "persistence",
      severity: "high",
      points: 6,
      change: "appeared",
      changedAt: NOW,
      gated: false,
      snoozedUntil: null,
      hasStartupEntry: true,
      isListener: false,
      actionIds: ["act.disconnect_network"],
      modelSentence: null,
      modelProvider: null,
      ...over,
    });
    const items = [item("sig.persistence_new"), item("sig.listener_new_ports", { kind: "listener" }), item("sig.remote_access_on", { kind: "remote", gated: true }), item("sig.firewall", { kind: "guard", snoozedUntil: "2026-10-20T00:00:00.000Z" })];
    const h = mount({ state: fakeWatchState({ rating: "act_now", items }) });
    await flush();
    expect(snoozeTargets(h.hook.result.current.state, "sig.persistence_new")).toEqual(["sig.persistence_new", "sig.listener_new_ports"]);
    await act(() => h.hook.result.current.notNow("act.disconnect_network", "sig.persistence_new"));
    expect(h.saveMemory).toHaveBeenCalledWith({
      ...EMPTY_WATCH_MEMORY,
      actionNotNow: { "act.disconnect_network": NOW },
      snoozedSignals: { "sig.persistence_new": "2026-10-31T12:00:00.000Z", "sig.listener_new_ports": "2026-10-31T12:00:00.000Z" },
    });
    expect(h.port.snooze).toHaveBeenCalledTimes(2);
    expect(h.port.snooze).toHaveBeenCalledWith("sig.persistence_new");
    expect(h.port.snooze).toHaveBeenCalledWith("sig.listener_new_ports");
  });

  it("notNow on a look state snoozes only the item it was pressed on", () => {
    const state = fakeWatchState({ rating: "keep_an_eye", items: [] });
    expect(snoozeTargets(state, "sig.persistence_new")).toEqual(["sig.persistence_new"]);
    expect(snoozeTargets(null, "sig.persistence_new")).toEqual(["sig.persistence_new"]);
  });

  it("answerGate writes normalForMe only for Yes, and always reaches the port", async () => {
    const h = mount();
    await flush();
    await act(() => h.hook.result.current.answerGate("sig.firewall", false));
    expect(h.saveMemory).not.toHaveBeenCalled();
    await act(() => h.hook.result.current.answerGate("sig.firewall", true));
    expect(h.saveMemory).toHaveBeenCalledWith({ ...EMPTY_WATCH_MEMORY, normalForMe: { "sig.firewall": NOW } });
    expect(vi.mocked(h.port.answerGate).mock.calls).toEqual([["sig.firewall", false], ["sig.firewall", true]]);
  });

  it("markFishyRan writes fishyRanAt; saveMemory passes through; memory is the deps' memory", async () => {
    const seeded: WatchMemory = { ...EMPTY_WATCH_MEMORY, fishyRanAt: "2026-10-01T00:00:00.000Z" };
    const h = mount({ memory: seeded });
    await flush();
    expect(h.hook.result.current.memory).toBe(seeded);
    act(() => h.hook.result.current.markFishyRan());
    expect(h.saveMemory).toHaveBeenCalledWith({ ...seeded, fishyRanAt: NOW });
    act(() => h.hook.result.current.saveMemory(EMPTY_WATCH_MEMORY));
    expect(h.saveMemory).toHaveBeenLastCalledWith(EMPTY_WATCH_MEMORY);
  });
});

describe("useWatchStatus", () => {
  it("answers status() first, then every watch:state, and a late status() never overwrites an event", async () => {
    let listener: ((state: WatchState) => void) | null = null;
    let resolveStatus: (state: WatchState) => void = () => undefined;
    const port = fakeWatchPort({
      status: vi.fn(() => new Promise<WatchState>((resolve) => { resolveStatus = resolve; })),
      onState: vi.fn((cb: (state: WatchState) => void) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
    });
    const hook = renderHook(() => useWatchStatus(port));
    expect(hook.result.current).toBeNull();
    const fromEvent = fakeWatchState({ rating: "keep_an_eye" });
    act(() => listener?.(fromEvent));
    expect(hook.result.current).toBe(fromEvent);
    await act(async () => {
      resolveStatus(fakeWatchState());
      await Promise.resolve();
    });
    expect(hook.result.current).toBe(fromEvent);
    hook.unmount();
    expect(listener).toBeNull();
  });

  it("shows the status() answer when no event arrived first, and ignores a failing status()", async () => {
    const state = fakeWatchState({ firstRun: true });
    const hook = renderHook(() => useWatchStatus(fakeWatchPort({}, state)));
    await flush();
    expect(hook.result.current).toBe(state);
    const failing = renderHook(() => useWatchStatus(fakeWatchPort({ status: vi.fn(async () => { throw "forbidden_window"; }) })));
    await flush();
    expect(failing.result.current).toBeNull();
  });
});
