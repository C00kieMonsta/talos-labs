import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiAvailability, Capabilities, GuidedMemory, LicenseState, RuleId, ScanReport, WatchAi, WatchMemory, WatchOpenScreen } from "@talos/core";
import { EMPTY_GUIDED_MEMORY, acceptRules, unacceptRule } from "@talos/core";
import { AppContext, useApp } from "./app/context";
import type { AppContextValue } from "./app/context";
import { adapters, buildContext, catalog, loadSettings, runEngine, saveSettings } from "./app/container";
import { buildGate } from "./app/gate";
import { ICONS } from "./app/icons";
import { parseWatchDemoQuery } from "./app/demo-boot";
import { useRouter } from "./app/router";
import type { Route, RouteMove } from "./app/router";
import { CHECKUP_LABEL, SCAN_ERROR_LABELS, askSubtitle, formatDateTime } from "./app/labels";
import { useScan } from "./scan/useScan";
import { useScanPacer } from "./scan/useScanPacer";
import { useAiAvailability, REPROBE_SETTINGS_MS, limitReprobeMs } from "./scan/useAiAvailability";
import { AiConnectContext, CONNECT_POLL_MS, useConnect } from "./scan/ai-connect";
import { useAiConnect } from "./scan/useAiConnect";
import type { PermissionKind } from "./scan/useCapabilityPoll";
import { readContinue } from "./guided/continue";
import type { ContinuePayload } from "./guided/continue";
import { loadGuidedMemory, saveGuidedMemory } from "./guided/memory";
import { claimLaunchScan, resetLaunchGuard } from "./guided/timing";
import { useGuided } from "./guided/useGuided";
import type { GuidedController } from "./guided/useGuided";
import { GuidedShell } from "./guided/GuidedShell";
import { Guided } from "./guided/screens/Guided";
import { ConnectScreen } from "./guided/ConnectScreen";
import { FishyFlow } from "./guided/FishyFlow";
import { FishyContext } from "./guided/fishy/controller";
import { useFishy } from "./guided/fishy/useFishy";
import { loadWatchMemory, saveWatchMemory } from "./watch/memory";
import { useWatch } from "./watch/useWatch";
import { WatchControllerContext } from "./watch/watch-controller";
import { SCANNING_TITLE } from "./guided/copy";
import { lastReport } from "./scan/machine";
import type { ScanState } from "./scan/machine";
import { aiUsable as computeAiUsable } from "./settings";
import type { AppSettings, WatchSettings } from "./settings";
import { Brand } from "./components/Brand";
import { GradientDefs } from "./components/GradientDefs";
import { Sidebar } from "./components/Sidebar";
import type { NavItem, SidebarKey } from "./components/Sidebar";
import { Icon } from "./components/Icon";
import { Toolbar } from "./components/Toolbar";
import type { ToolbarAction } from "./components/Toolbar";
import { ScreenErrorBoundary } from "./components/ScreenErrorBoundary";
import { Welcome } from "./screens/Welcome";
import { Scanning } from "./screens/Scanning";
import { Overview } from "./screens/Overview";
import { Findings } from "./screens/Findings";
import { FindingDetail } from "./screens/FindingDetail";
import { Ask } from "./screens/Ask";
import { Settings } from "./screens/Settings";
import type { ProviderInfo } from "./screens/Settings";

const NAV_ROUTES: Readonly<Record<SidebarKey, Route>> = {
  checkup: { name: "guided" },
  overview: { name: "overview" },
  findings: { name: "findings" },
  ask: { name: "ask" },
  settings: { name: "settings" },
};

/** True inside the Tauri webview; the browser demo and jsdom have no window API. */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** A fix, a batch, a recheck or a watcher is in flight: the launch scan must not interrupt it (DESIGN-V03 section 4). */
export function fixInFlight(state: ScanState): boolean {
  if (state.kind === "rechecking") return true;
  if (state.kind !== "ready") return false;
  if (state.watching !== null && state.watching.passedAt === null) return true;
  return state.fixing !== null && state.fixing.phase !== "done" && state.fixing.phase !== "failed";
}

/** The demo's ?ransomNote=1 ticks the fishy flow's checkbox; a build-time choice, never read in the real app. */
function demoRansomNote(): boolean {
  if (import.meta.env.VITE_TALOS_DEMO !== "1" || typeof window === "undefined") return false;
  return parseWatchDemoQuery(new URLSearchParams(window.location.search)).ransomNote;
}

/** What Rust's watch cycle may call: the AI switch and the consumer provider; Developer providers stay in the webview. */
function watchAiFor(settings: AppSettings): WatchAi {
  const { aiEnabled, provider } = settings.explainer;
  const consumer = provider === "apple" || provider === "chatgpt" || provider === "claude_plan";
  return { enabled: aiEnabled && consumer, provider: consumer ? provider : null };
}

/** Adds .window-inactive to the shell while the window is in the background, like Finder. */
function useWindowInactive(): boolean {
  const [inactive, setInactive] = useState(false);
  useEffect(() => {
    if (!inTauri()) {
      // The browser demo: DOM focus and blur stand in, so the guide's timers pause the same way.
      const onFocus = () => setInactive(false);
      const onBlur = () => setInactive(true);
      window.addEventListener("focus", onFocus);
      window.addEventListener("blur", onBlur);
      return () => {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("blur", onBlur);
      };
    }
    let unlisten: (() => void) | null = null;
    let gone = false;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged(({ payload }) => setInactive(!payload)))
      .then((off) => {
        if (gone) off();
        else unlisten = off;
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);
  return inactive;
}

/** The app menu emits menu:navigate for Settings (Cmd+,) and About; About is the last section of Settings. */
function useMenuNavigate(onNavigate: (target: "settings" | "about") => void) {
  const ref = useRef(onNavigate);
  ref.current = onNavigate;
  useEffect(() => {
    if (!inTauri()) return;
    let unlisten: (() => void) | null = null;
    let gone = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ route: "settings" | "about" }>("menu:navigate", ({ payload }) => ref.current(payload.route)),
      )
      .then((off) => {
        if (gone) off();
        else unlisten = off;
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);
}

/**
 * The read-only Developer lines in Settings: asked once per Settings visit in the real build, and only
 * in Developer mode, since `claude_code_info` runs codesign on the install; always null in demo and jsdom.
 */
function useProviderInfo(enabled: boolean): ProviderInfo {
  const [info, setInfo] = useState<ProviderInfo>({ claudeCode: null, chatgptClientId: null });
  useEffect(() => {
    if (!enabled || !inTauri()) return;
    let gone = false;
    void import("@tauri-apps/api/core")
      .then(async ({ invoke }) => {
        const [claudeCode, chatgpt] = await Promise.all([
          invoke<ProviderInfo["claudeCode"]>("claude_code_info", {}).catch(() => null),
          invoke<{ offered: boolean; clientId: string | null }>("chatgpt_info", {}).catch(() => null),
        ]);
        if (!gone) setInfo({ claudeCode, chatgptClientId: chatgpt?.clientId ?? null });
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [enabled]);
  return info;
}

/** The continue note is read once per launch, before the first render, so the guided controller can resume. */
let continueNote: ContinuePayload | null | undefined;

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [license, setLicense] = useState<LicenseState>({ status: "none" });
  // True once license.current() has resolved; a rejected read never pushes a gate to Rust.
  const [licenseRead, setLicenseRead] = useState(false);
  const [memory, setMemory] = useState<GuidedMemory>(() => loadGuidedMemory());
  // Ids only: the model and the watch see which checks were left alone, never why.
  const acceptedIds = useMemo(() => Object.keys(memory.accepted) as RuleId[], [memory]);
  const acceptedRef = useRef<readonly RuleId[]>([]);
  acceptedRef.current = acceptedIds;
  const [watchMemory, setWatchMemory] = useState<WatchMemory>(() => loadWatchMemory());
  if (continueNote === undefined) continueNote = readContinue();
  const resume = continueNote?.kind === "guided";
  const router = useRouter(settings.guided.home ? { name: "guided" } : { name: "overview" });
  const inactive = useWindowInactive();
  const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const deps = useMemo(
    () => ({
      adapters,
      engine: runEngine,
      createExplainer: () => adapters.createExplainer(settings.explainer),
      toContext: (report: ScanReport) => buildContext(report, settings.profile, acceptedRef.current),
    }),
    [settings.explainer, settings.profile],
  );
  const scan = useScan(deps);
  const { loadLast, start } = scan;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const scanStateRef = useRef(scan.scan);
  scanStateRef.current = scan.scan;
  // The report loadLast found, kept for the guide's "since last time" diff; the launch scan drops it from the machine.
  const loadedReport = useRef<ScanReport | null>(null);

  // "Check my Mac when I open Talos Labs": once per launch and once per showing of a hidden window, never twice within 60 s,
  // and never while a fix, a batch, a recheck or a watcher is in flight (DESIGN-V03 section 4).
  const launchScan = useCallback(() => {
    const current = settingsRef.current;
    if (!current.onboarded || !current.guided.autoScan || !current.guided.home) return;
    if (fixInFlight(scanStateRef.current)) return;
    if (!claimLaunchScan()) return;
    void start();
  }, [start]);
  // The launch scan: after loadLast so the previous report is held for the diff. A --watch login launch
  // keeps the window hidden; its scan waits for main:shown instead.
  useEffect(() => {
    const held = adapters.reports.loadLast().then(
      (report) => {
        loadedReport.current = report;
      },
      () => undefined,
    );
    const hidden = adapters.watch.status().then(
      (state) => state.hiddenLaunch,
      () => false,
    );
    void Promise.all([loadLast(), held, hidden]).then(([, , hiddenLaunch]) => {
      if (!hiddenLaunch) launchScan();
    });
    void adapters.license
      .current()
      .then((state) => {
        setLicense(state);
        setLicenseRead(true);
      })
      .catch(() => setLicense({ status: "none" }));
  }, [loadLast, launchScan]);

  const report = lastReport(scan.scan);
  const gate = useMemo(() => buildGate(report, license), [report, license]);
  const ai = useAiAvailability(deps.createExplainer);
  const aiUsable = computeAiUsable(settings, ai.availability);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const refreshCapabilities = useCallback(async () => {
    try {
      const next = await adapters.systemState.capabilities();
      setCapabilities(next);
      return next;
    } catch {
      return null;
    }
  }, []);
  // A Full Disk Access grant needs a relaunch; on the expert home the relaunch continues with a fresh scan when it took.
  useEffect(() => {
    const pending = continueNote;
    void refreshCapabilities().then((caps) => {
      if (pending?.kind === "fda" && caps?.fullDiskAccess === true && !settingsRef.current.guided.home) void start();
    });
  }, [refreshCapabilities, start]);

  const saveMemory = useCallback((next: GuidedMemory) => {
    saveGuidedMemory(next);
    setMemory(next);
  }, []);
  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  const acceptRule = useCallback((id: RuleId) => saveMemory(acceptRules(memoryRef.current, [id], new Date().toISOString())), [saveMemory]);
  const unaccept = useCallback((id: RuleId) => saveMemory(unacceptRule(memoryRef.current, id)), [saveMemory]);
  // Lives here, not in the Connect screen, so a running sign-in keeps being polled while the person visits other screens.
  const connect = useAiConnect({ port: adapters.aiConnect, router, settings, updateSettings, memory, saveMemory, ai, windowFocused: !inactive, reducedMotion });
  const saveWatch = useCallback((next: WatchMemory) => {
    saveWatchMemory(next);
    setWatchMemory(next);
  }, []);
  const updateWatchSettings = useCallback((patch: Partial<WatchSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, watch: { ...prev.watch, ...patch } };
      saveSettings(next);
      return next;
    });
  }, []);
  // The menu bar watch: Rust holds the truth for enabled, interval and notify; this controller mirrors it into settings.
  const watch = useWatch({
    port: adapters.watch,
    settings: settings.watch,
    profile: settings.profile,
    ai: watchAiFor(settings),
    licensed: licenseRead ? gate.licensed : null,
    accepted: acceptedIds,
    updateSettings: updateWatchSettings,
    memory: watchMemory,
    saveMemory: saveWatch,
  });
  // The paste that activates the watch is the foreground moment that asks macOS for notification permission, once (DESIGN-WATCH.md section 7).
  const licensedBefore = useRef<boolean | null>(null);
  const watchNotify = settings.watch.enabled && settings.watch.notify;
  const notifyAsked = watchMemory.notifyAskedAt !== null;
  const requestNotify = watch.requestNotifyPermission;
  useEffect(() => {
    if (!licenseRead) return;
    const previous = licensedBefore.current;
    licensedBefore.current = gate.licensed;
    if (previous === false && gate.licensed && watchNotify && !notifyAsked) void requestNotify();
  }, [licenseRead, gate.licensed, watchNotify, notifyAsked, requestNotify]);
  const fishy = useFishy({ watch, adapters, router, settings, ransomNote: demoRansomNote() });
  const guided = useGuided(scan, {
    gate,
    settings,
    memory,
    saveMemory,
    capabilitiesNow: capabilities,
    capabilities: () => adapters.systemState.capabilities(),
    openPane: (pane) => adapters.openSettingsPane(pane),
    collectSection: (key) => adapters.systemState.collectSection(key),
    restart: () => adapters.restart(),
    reducedMotion,
    windowFocused: !inactive,
    resume,
    loadedReport: () => loadedReport.current,
  });

  const scanning = scan.scan.kind === "collecting" || scan.scan.kind === "evaluating" || scan.scan.kind === "presenting";
  const showShell = settings.onboarded;
  // Skip the focus on the screen a launch lands on; keyed on the route so a repeated effect run (StrictMode) skips too.
  const launchKey = useRef<string | null | undefined>(undefined);
  if (launchKey.current === undefined) launchKey.current = showShell && !scanning ? routeKey(router.route) : null;
  useEffect(() => {
    if (!showShell || scanning) launchKey.current = null;
  }, [showShell, scanning]);

  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  useMenuNavigate((target) => {
    router.navigate({ name: "settings" });
    setPendingAnchor(target === "about" ? "about" : null);
  });
  // The tray, a notification tap and the small window's links: the fishy flow opens only when the watch has something to show.
  const onWatchOpen = useRef<(screen: WatchOpenScreen) => void>(() => undefined);
  onWatchOpen.current = (screen) => {
    if (screen === "settings_watch") {
      router.navigate({ name: "settings" });
      setPendingAnchor("watch");
    } else if (screen === "noticed" && router.route.name !== "fishy" && watch.state?.licensed === true && watch.state.items.length > 0) {
      // A flow already on screen stays: a second entry would land back on the flow after Done.
      fishy.open(router.route, "noticed");
    }
  };
  useEffect(() => adapters.watch.onOpen(({ screen }) => onWatchOpen.current(screen)), []);
  // With the watch on, closing the window hides it, so a reopen is a show, not a relaunch: the launch scan
  // runs here. Not for noticed or settings_watch, which land the person on another screen.
  const onMainShown = useRef<(screen: WatchOpenScreen) => void>(() => undefined);
  onMainShown.current = (screen) => {
    if (screen === "home") launchScan();
  };
  useEffect(() => adapters.watch.onShown(({ screen }) => onMainShown.current(screen)), []);
  useEffect(() => {
    if (pendingAnchor === null || router.route.name !== "settings") return;
    // Settings sections carry their id on the heading.
    document.getElementById(`${pendingAnchor}-heading`)?.scrollIntoView({ block: "start" });
    setPendingAnchor(null);
  }, [pendingAnchor, router.route.name]);

  const value: AppContextValue = useMemo(
    () => ({ adapters, catalog, settings, updateSettings, license, setLicense, gate, scan, router, aiUsable, ai, capabilities, refreshCapabilities, guidedMemory: memory, acceptRule, unacceptRule: unaccept }),
    [settings, updateSettings, license, gate, scan, router, aiUsable, ai, capabilities, refreshCapabilities, memory, acceptRule, unaccept],
  );

  const guidedHome = settings.guided.home;
  const onWelcomeStart = () => {
    updateSettings({ onboarded: true });
    guided.start();
  };

  if (!showShell && guidedHome) {
    return (
      <AiConnectContext.Provider value={connect}>
      <AppContext.Provider value={value}>
      <WatchControllerContext.Provider value={watch}>
      <FishyContext.Provider value={fishy}>
        <GradientDefs />
        <GuidedShell inactive={inactive}>
          <Guided controller={guided} onWelcomeStart={onWelcomeStart} />
        </GuidedShell>
      </FishyContext.Provider>
      </WatchControllerContext.Provider>
      </AppContext.Provider>
      </AiConnectContext.Provider>
    );
  }
  if (!showShell) {
    return (
      <AiConnectContext.Provider value={connect}>
      <AppContext.Provider value={value}>
      <WatchControllerContext.Provider value={watch}>
      <FishyContext.Provider value={fishy}>
        <GradientDefs />
        <Welcome
          initial={settings.profile}
          onStart={(profile) => {
            updateSettings({ profile, onboarded: true });
            void scan.start();
          }}
          onSkip={() => updateSettings({ onboarded: true })}
        />
      </FishyContext.Provider>
      </WatchControllerContext.Provider>
      </AppContext.Provider>
      </AiConnectContext.Provider>
    );
  }

  if (router.route.name === "guided") {
    return (
      <AiConnectContext.Provider value={connect}>
      <AppContext.Provider value={value}>
      <WatchControllerContext.Provider value={watch}>
      <FishyContext.Provider value={fishy}>
        <GradientDefs />
        {scanning ? (
          <ScanningShell guided inactive={inactive} />
        ) : (
          <GuidedShell inactive={inactive}>
            <ScreenErrorBoundary resetKey={`guided:${guided.phase.kind}`} onRescan={() => guided.start()} onSettings={() => router.navigate({ name: "settings" })}>
              <Guided controller={guided} onWelcomeStart={onWelcomeStart} />
            </ScreenErrorBoundary>
          </GuidedShell>
        )}
      </FishyContext.Provider>
      </WatchControllerContext.Provider>
      </AppContext.Provider>
      </AiConnectContext.Provider>
    );
  }

  if (router.route.name === "connect") {
    return (
      <AiConnectContext.Provider value={connect}>
      <AppContext.Provider value={value}>
      <WatchControllerContext.Provider value={watch}>
      <FishyContext.Provider value={fishy}>
        <GradientDefs />
        <GuidedShell inactive={inactive}>
          <ScreenErrorBoundary resetKey="connect" onRescan={() => guided.start()} onSettings={() => router.navigate({ name: "settings" })}>
            <ConnectScreen />
          </ScreenErrorBoundary>
        </GuidedShell>
      </FishyContext.Provider>
      </WatchControllerContext.Provider>
      </AppContext.Provider>
      </AiConnectContext.Provider>
    );
  }

  if (router.route.name === "fishy") {
    return (
      <AiConnectContext.Provider value={connect}>
      <AppContext.Provider value={value}>
      <WatchControllerContext.Provider value={watch}>
      <FishyContext.Provider value={fishy}>
        <GradientDefs />
        <GuidedShell inactive={inactive}>
          <ScreenErrorBoundary resetKey="fishy" onRescan={() => guided.start()} onSettings={() => router.navigate({ name: "settings" })}>
            <FishyFlow />
          </ScreenErrorBoundary>
        </GuidedShell>
      </FishyContext.Provider>
      </WatchControllerContext.Provider>
      </AppContext.Provider>
      </AiConnectContext.Provider>
    );
  }

  // Ask is listed while a remote provider is chosen but not yet connected, so its Connect row is reachable.
  const { provider, aiEnabled } = settings.explainer;
  const showAsk = aiUsable || (aiEnabled && (provider === "chatgpt" || provider === "claude_plan"));
  const items: NavItem[] = [
    { name: "checkup", label: CHECKUP_LABEL },
    { name: "overview", label: "Overview" },
    { name: "findings", label: "Findings" },
    ...(showAsk ? [{ name: "ask" as const, label: "Ask" }] : []),
  ];
  const current: SidebarKey = router.route.name === "finding" ? "findings" : router.route.name;

  return (
    <AiConnectContext.Provider value={connect}>
    <AppContext.Provider value={value}>
    <WatchControllerContext.Provider value={watch}>
    <FishyContext.Provider value={fishy}>
      <GradientDefs />
      <div className={inactive ? "shell shell-expert window-inactive" : "shell shell-expert"}>
        <ExpertTitlebar scanning={scanning} />
        <div className="expert-shell">
          <Sidebar
            items={items}
            current={current}
            license={license}
            dimmed={scanning}
            onSelect={(name) => router.navigate(NAV_ROUTES[name])}
          />
          <div className="content">
            {scanning ? (
              <ScanningShell guided={false} inactive={inactive} />
            ) : (
              <ScreenErrorBoundary
                resetKey={routeKey(router.route)}
                onRescan={() => void scan.start()}
                onSettings={() => router.navigate({ name: "settings" })}
              >
                <Screen launchKey={launchKey} guided={guided} onResetMemory={() => saveMemory(EMPTY_GUIDED_MEMORY)} />
              </ScreenErrorBoundary>
            )}
          </div>
        </div>
      </div>
    </FishyContext.Provider>
    </WatchControllerContext.Provider>
    </AppContext.Provider>
    </AiConnectContext.Provider>
  );
}

/**
 * The 52 px strip across the expert shell: the brand after the traffic lights, text actions on the right.
 * "‹ Check-up" leads back to the guided home; a finding keeps its own "‹ Findings" in the page head instead.
 */
function ExpertTitlebar({ scanning }: { scanning: boolean }) {
  const { router, settings } = useApp();
  const showCheckup = settings.guided.home && router.route.name !== "finding";
  return (
    <header className="titlebar title-strip" data-tauri-drag-region="true">
      <Brand />
      {!scanning && (
        <div className="top-actions">
          {showCheckup && (
            <button type="button" className="toolbar-back" onClick={() => router.navigate({ name: "guided" })}>
              <Icon icon={ICONS.chevronLeft} />
              <span>{CHECKUP_LABEL}</span>
            </button>
          )}
          <button type="button" className="titlebar-link" onClick={() => router.navigate({ name: "settings" })}>
            Settings
          </button>
        </div>
      )}
    </header>
  );
}

function routeKey(route: Route): string {
  return route.name === "finding" ? `finding:${route.ruleId}` : route.name;
}

/** The content column during a check-up: the Cancel icon button lives in the toolbar so it is always above the fold. */
function ScanningShell({ guided, inactive }: { guided: boolean; inactive: boolean }) {
  const { scan } = useApp();
  const [cancelling, setCancelling] = useState(false);
  const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pacer = useScanPacer(scan, { reducedMotion });
  const report = scan.scan.kind === "presenting" ? scan.scan.report : null;
  const disabled = cancelling || pacer.phase === "done";
  // This column replaces the routed screen, so it moves focus to its toolbar title the way routed screens do.
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>(".toolbar h1");
    if (heading === null) return;
    heading.tabIndex = -1;
    heading.focus();
  }, []);
  const cancel = () => {
    if (disabled) return;
    setCancelling(true);
    scan.cancel();
  };
  const actions = [{ label: cancelling ? "Cancelling" : "Cancel", icon: ICONS.close, onClick: cancel, disabled }];
  if (guided) {
    return (
      <GuidedShell title={SCANNING_TITLE} actions={actions} inactive={inactive}>
        <Scanning pacer={pacer} report={report} guided />
      </GuidedShell>
    );
  }
  // The expert column is the main landmark here, as the routed host is, so the page head sits inside it.
  return (
    <main className="screen-host">
      <Toolbar title="Checking your Mac" actions={actions} />
      <Scanning pacer={pacer} report={report} />
    </main>
  );
}

function Banners() {
  const { scan } = useApp();
  return (
    <>
      {scan.scan.kind === "failed" && (
        <div className="banner" role="status">
          {SCAN_ERROR_LABELS[scan.scan.error]}{" "}
          <button type="button" className="link-button" onClick={() => void scan.start()}>
            Try again
          </button>{" "}
          <button type="button" className="link-button" onClick={scan.dismissFailure} aria-label="Dismiss this message">
            Dismiss
          </button>
        </div>
      )}
      {scan.notice !== null && (
        <div className="banner" role="status">
          {scan.notice}{" "}
          <button type="button" className="link-button" onClick={scan.dismissNotice} aria-label="Dismiss notice">
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

/** Toolbar contents per route. Screens that own their h1 (a finding) get no title here. */
function RouteToolbar({ route }: { route: Route }) {
  const { scan, router, settings } = useApp();
  const report = lastReport(scan.scan);
  const rescan: ToolbarAction = { label: "Rescan", icon: ICONS.rescan, onClick: () => void scan.start() };
  switch (route.name) {
    case "guided":
      return null;
    case "overview":
      return (
        <Toolbar
          title="Overview"
          subtitle={report === null ? undefined : `Last check-up ${formatDateTime(report.scannedAt)}`}
          actions={report === null ? [] : [rescan]}
        />
      );
    case "findings":
      return (
        <Toolbar title="Findings" actions={report === null ? [] : [rescan]}>
          <div id="toolbar-slot" className="toolbar-slot" />
        </Toolbar>
      );
    case "finding":
      return <Toolbar back={{ label: "Findings", onClick: () => router.back() }} />;
    case "ask":
      return <Toolbar title="Ask about your report" subtitle={askSubtitle(settings.explainer.provider)} />;
    case "settings":
      return <Toolbar title="Settings" />;
    case "connect":
      return null;
    case "fishy":
      return null;
  }
}

function Screen({ launchKey, guided, onResetMemory }: { launchKey: { current: string | null | undefined }; guided: GuidedController; onResetMemory(): void }) {
  const { route, lastMove } = useApp().router;
  const host = useRef<HTMLElement>(null);
  const key = routeKey(route);
  // Read inside the effect without re-running it on every render.
  const moveRef = useRef<{ route: Route; lastMove: RouteMove }>({ route, lastMove });
  moveRef.current = { route, lastMove };
  const previous = useRef<Route>(route);

  // Focus the new screen's heading, or on Back from a finding the card it was opened from if it is still shown.
  useEffect(() => {
    const from = previous.current;
    previous.current = moveRef.current.route;
    if (key === launchKey.current) return;
    launchKey.current = null;
    if (moveRef.current.lastMove === "back" && from.name === "finding") {
      const card = host.current?.querySelector(`[data-rule-id="${from.ruleId}"]`);
      if (card instanceof HTMLElement) {
        const link = card.querySelector("a.finding-card-title");
        (link instanceof HTMLElement ? link : card).focus();
        return;
      }
    }
    const heading = host.current?.querySelector("h1");
    if (heading === null || heading === undefined) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [key, launchKey]);

  // The host is the main landmark, so the page head and banners sit inside it with the screen body.
  return (
    <main ref={host} className="screen-host">
      <RouteToolbar route={route} />
      <Banners />
      {screenFor(route, guided, onResetMemory)}
    </main>
  );
}

/** Settings with the live AI and permission state. */
function SettingsRoute({ guided, onResetMemory }: { guided: GuidedController; onResetMemory(): void }) {
  const { adapters: ports, ai, capabilities, refreshCapabilities, scan, settings } = useApp();
  const connect = useConnect();
  const providerInfo = useProviderInfo(settings.developer.enabled);
  const { probe, reprobe, availability, until } = ai;
  const { ensureOffered } = connect;
  // Settings is an AI surface: it asks which rows can be offered, so "Change" knows whether a Connect screen has a row.
  // With AI off nothing is asked, so the helper is never started from here.
  const aiEnabled = settings.explainer.aiEnabled;
  useEffect(() => {
    if (aiEnabled) ensureOffered();
  }, [aiEnabled, ensureOffered]);
  useEffect(() => {
    if (availability === null) void probe();
  }, [probe, availability]);
  // The "Connecting" and "Limit reached" pills refresh on the same schedules as the cards.
  useEffect(() => {
    if (availability !== "connecting") return;
    return reprobe(CONNECT_POLL_MS);
  }, [availability, reprobe]);
  useEffect(() => {
    if (availability !== "limit_reached") return;
    const timer = setTimeout(() => void probe(true), limitReprobeMs(until));
    return () => clearTimeout(timer);
  }, [availability, until, probe]);
  const onAiAction = (state: AiAvailability) => {
    if (state === "apple_intelligence_not_enabled") {
      void ports.openSettingsPane("apple_intelligence");
      ai.reprobe(REPROBE_SETTINGS_MS);
    } else void ai.probe(true);
  };
  const onPermission = (kind: PermissionKind, status: string) => {
    if (kind === "automation" && status === "not_determined") {
      void ports.systemState.collectSection("loginItems").finally(() => void refreshCapabilities());
      return;
    }
    void ports.openSettingsPane(kind);
    void scan.recheck([]);
  };
  return (
    <Settings
      aiAvailability={availability}
      onAiAction={onAiAction}
      capabilities={capabilities}
      onPermission={onPermission}
      onBuy={() => void ports.fixes.openBuyPage()}
      guided={{ controller: guided, onResetMemory, onSkipCooldown: resetLaunchGuard }}
      onChangeAi={() => connect.open({ name: "settings" })}
      // With nothing to connect and On this Mac hidden the Connect screen has no row, so Change is not offered.
      canChangeAi={connect.offered === null || connect.connectable || connect.offered.apple}
      onDisconnect={() => connect.disconnect()}
      providerInfo={providerInfo}
    />
  );
}

function screenFor(route: Route, guided: GuidedController, onResetMemory: () => void) {
  switch (route.name) {
    case "guided":
      return null;
    case "overview":
      return <Overview />;
    case "findings":
      return <Findings />;
    case "finding":
      return <FindingDetail ruleId={route.ruleId} />;
    case "ask":
      return <Ask />;
    case "settings":
      return <SettingsRoute guided={guided} onResetMemory={onResetMemory} />;
    case "connect":
      return null;
    case "fishy":
      return null;
  }
}
