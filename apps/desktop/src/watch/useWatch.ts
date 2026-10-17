import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionId, ExplainerProfile, SignalId, WatchAi, WatchInterval, WatchMemory, WatchPort, WatchState } from "@talos/core";
import { AI_ASK_AGAIN_MS } from "@talos/core";
import type { WatchSettings } from "../settings";
import type { WatchController } from "./watch-controller";

/** The port's state: status() once, then every watch:state. The window and App both use it. */
export function useWatchStatus(port: Pick<WatchPort, "status" | "onState">): WatchState | null {
  const [state, setState] = useState<WatchState | null>(null);
  useEffect(() => {
    let live = true;
    const off = port.onState((next) => {
      if (live) setState(next);
    });
    port.status().then(
      (next) => {
        if (live) setState((current) => current ?? next);
      },
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [port]);
  return state;
}

export interface WatchDeps {
  readonly port: WatchPort;
  readonly settings: WatchSettings;
  readonly profile: ExplainerProfile;
  /** The AI switch and consumer provider, so Rust's cycle calls the chosen provider; absent, Rust picks a connected one. */
  readonly ai?: WatchAi;
  /** The product gate the webview reports; null until the licence has been read, and nothing is pushed while null. */
  readonly licensed: boolean | null;
  updateSettings(patch: Partial<WatchSettings>): void;
  readonly memory: WatchMemory;
  saveMemory(next: WatchMemory): void;
  readonly now?: () => string;
}

/** The three keys Rust's watch-settings.json owns; the webview copy follows them. An unlicensed state also drops the login item. */
export function settingsPatch(state: WatchState, settings: WatchSettings): Partial<WatchSettings> | null {
  const patch: { -readonly [K in keyof WatchSettings]?: WatchSettings[K] } = {};
  if (state.enabled !== settings.enabled) patch.enabled = state.enabled;
  if (state.everyMinutes !== settings.everyMinutes) patch.everyMinutes = state.everyMinutes;
  if (state.notify !== settings.notify) patch.notify = state.notify;
  if (!state.licensed && settings.startAtLogin) patch.startAtLogin = false;
  return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * The watch controller for App. On mount it reads status() and autostartIsEnabled() and
 * writes what Rust holds back into settings, and pushes the profile; it never changes the
 * watch on its own. Every setter calls the port first and writes settings only on success.
 */
export function useWatch(deps: WatchDeps): WatchController {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [state, setState] = useState<WatchState | null>(null);
  const [startAtLogin, setStartAtLogin] = useState<boolean | null>(null);
  const now = useCallback(() => depsRef.current.now?.() ?? new Date().toISOString(), []);
  const { port } = deps;

  // Mount: status(), then onState; each state read reconciles the three Rust-owned keys.
  useEffect(() => {
    let live = true;
    const apply = (next: WatchState) => {
      if (!live) return;
      setState(next);
      // Rust disabled the LaunchAgent when the licence went; the cache follows.
      if (!next.licensed) setStartAtLogin(false);
      const patch = settingsPatch(next, depsRef.current.settings);
      if (patch !== null) depsRef.current.updateSettings(patch);
    };
    const off = port.onState(apply);
    port.status().then(apply, () => undefined);
    port.autostartIsEnabled().then(
      (enabled) => {
        if (!live) return;
        setStartAtLogin(enabled);
        if (enabled !== depsRef.current.settings.startAtLogin) depsRef.current.updateSettings({ startAtLogin: enabled });
      },
      () => undefined,
    );
    return () => {
      live = false;
      off();
    };
  }, [port]);

  // The profile goes to Rust once the licence has been read, and whenever one of its four fields, the AI choice or the gate changes.
  const { role, technical, handlesClientData, laptopLeavesHome } = deps.profile;
  const aiEnabled = deps.ai?.enabled;
  const aiProvider = deps.ai?.provider;
  const { licensed } = deps;
  useEffect(() => {
    if (licensed === null) return;
    const profile = { role, technical, handlesClientData, laptopLeavesHome };
    const ai = aiEnabled === undefined ? undefined : { enabled: aiEnabled, provider: aiProvider ?? null };
    void port.setProfile(profile, ai, licensed).catch(() => undefined);
  }, [port, role, technical, handlesClientData, laptopLeavesHome, aiEnabled, aiProvider, licensed]);

  const write = useCallback((next: WatchMemory) => depsRef.current.saveMemory(next), []);

  const setEnabled = useCallback(
    async (v: boolean) => {
      try {
        await depsRef.current.port.setEnabled(v);
      } catch {
        return;
      }
      // Rust drops the login item with the watch, so the cache follows.
      if (v) {
        depsRef.current.updateSettings({ enabled: true });
      } else {
        setStartAtLogin(false);
        depsRef.current.updateSettings({ enabled: false, startAtLogin: false });
      }
    },
    [],
  );

  const setInterval = useCallback(async (m: WatchInterval) => {
    try {
      await depsRef.current.port.setInterval(m);
    } catch {
      return;
    }
    depsRef.current.updateSettings({ everyMinutes: m });
  }, []);

  const setNotify = useCallback(async (v: boolean) => {
    try {
      await depsRef.current.port.setNotify(v);
    } catch {
      return;
    }
    depsRef.current.updateSettings({ notify: v });
  }, []);

  const setStartAtLoginSetting = useCallback(async (v: boolean) => {
    try {
      if (v) await depsRef.current.port.autostartEnable();
      else await depsRef.current.port.autostartDisable();
    } catch {
      return;
    }
    setStartAtLogin(v);
    depsRef.current.updateSettings({ startAtLogin: v });
  }, []);

  // The one record that macOS's alert has been asked for; the welcome button, the Settings switch and the paste share it.
  const requestNotifyPermission = useCallback(async () => {
    try {
      await depsRef.current.port.requestNotifyPermission();
    } catch {
      return;
    }
    write({ ...depsRef.current.memory, notifyAskedAt: now() });
  }, [now, write]);

  const acknowledge = useCallback(
    async (signalId: SignalId) => {
      const { memory } = depsRef.current;
      const at = now();
      write({
        ...memory,
        normalForMe: { ...memory.normalForMe, [signalId]: at },
        acknowledgeCount: { ...memory.acknowledgeCount, [signalId]: (memory.acknowledgeCount[signalId] ?? 0) + 1 },
      });
      await depsRef.current.port.acknowledge(signalId).catch(() => undefined);
    },
    [now, write],
  );

  const answerGate = useCallback(
    async (signalId: SignalId, mine: boolean) => {
      if (mine) {
        const { memory } = depsRef.current;
        write({ ...memory, normalForMe: { ...memory.normalForMe, [signalId]: now() } });
      }
      await depsRef.current.port.answerGate(signalId, mine).catch(() => undefined);
    },
    [now, write],
  );

  const notNow = useCallback(
    async (actionId: ActionId, signalId: SignalId) => {
      const { memory } = depsRef.current;
      const at = now();
      const until = new Date(Date.parse(at) + AI_ASK_AGAIN_MS).toISOString();
      write({
        ...memory,
        actionNotNow: { ...memory.actionNotNow, [actionId]: at },
        snoozedSignals: { ...memory.snoozedSignals, [signalId]: until },
      });
      await depsRef.current.port.snooze(signalId).catch(() => undefined);
    },
    [now, write],
  );

  const checkNow = useCallback(() => {
    void depsRef.current.port.checkNow().catch(() => undefined);
  }, []);

  const pause = useCallback(() => {
    void depsRef.current.port.pause(60).catch(() => undefined);
  }, []);

  const openSource = useCallback((actionId: ActionId) => {
    void depsRef.current.port.openSource(actionId).catch(() => undefined);
  }, []);

  const markFishyRan = useCallback(() => {
    write({ ...depsRef.current.memory, fishyRanAt: now() });
  }, [now, write]);

  const { memory } = deps;
  return useMemo(
    (): WatchController => ({
      state,
      memory,
      startAtLogin,
      saveMemory: write,
      checkNow,
      pause,
      setEnabled,
      setInterval,
      setNotify,
      setStartAtLogin: setStartAtLoginSetting,
      requestNotifyPermission,
      acknowledge,
      answerGate,
      notNow,
      openSource,
      markFishyRan,
    }),
    [state, memory, startAtLogin, write, checkNow, pause, setEnabled, setInterval, setNotify, setStartAtLoginSetting, requestNotifyPermission, acknowledge, answerGate, notNow, openSource, markFishyRan],
  );
}
