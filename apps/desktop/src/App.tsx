import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiAvailability, Capabilities, LicenseState, ScanReport } from "@talos/core";
import { AppContext, useApp } from "./app/context";
import type { AppContextValue } from "./app/context";
import { adapters, buildContext, catalog, loadSettings, runEngine, saveSettings } from "./app/container";
import { buildGate } from "./app/gate";
import { ICONS } from "./app/icons";
import type { NavKey } from "./app/icons";
import { useRouter } from "./app/router";
import type { Route, RouteMove } from "./app/router";
import { SCAN_ERROR_LABELS, formatDateTime } from "./app/labels";
import { useScan } from "./scan/useScan";
import { useScanPacer } from "./scan/useScanPacer";
import { useAiAvailability, REPROBE_SETTINGS_MS } from "./scan/useAiAvailability";
import { CONTINUE_KEY } from "./scan/useCapabilityPoll";
import type { PermissionKind } from "./scan/useCapabilityPoll";
import { lastReport } from "./scan/machine";
import { aiUsable as computeAiUsable } from "./settings";
import type { AppSettings } from "./settings";
import { Sidebar } from "./components/Sidebar";
import type { NavItem } from "./components/Sidebar";
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

const NAV_ROUTES: Readonly<Record<NavKey, Route>> = {
  overview: { name: "overview" },
  findings: { name: "findings" },
  ask: { name: "ask" },
  settings: { name: "settings" },
};

/** True inside the Tauri webview; the browser demo and jsdom have no window API. */
function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Adds .window-inactive to the shell while the window is in the background, like Finder. */
function useWindowInactive(): boolean {
  const [inactive, setInactive] = useState(false);
  useEffect(() => {
    if (!inTauri()) return;
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

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [license, setLicense] = useState<LicenseState>({ status: "none" });
  const router = useRouter();
  const inactive = useWindowInactive();

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
      toContext: (report: ScanReport) => buildContext(report, settings.profile),
    }),
    [settings.explainer, settings.profile],
  );
  const scan = useScan(deps);
  const { loadLast } = scan;

  useEffect(() => {
    void loadLast();
    void adapters.license
      .current()
      .then(setLicense)
      .catch(() => setLicense({ status: "none" }));
  }, [loadLast]);

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
  const { start } = scan;
  // A Full Disk Access grant needs a relaunch; the relaunch continues with a fresh scan when it took.
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = localStorage.getItem(CONTINUE_KEY);
      localStorage.removeItem(CONTINUE_KEY);
    } catch {
      pending = null;
    }
    void refreshCapabilities().then((caps) => {
      if (pending === "fda" && caps?.fullDiskAccess === true) void start();
    });
  }, [refreshCapabilities, start]);

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
  useEffect(() => {
    if (pendingAnchor === null || router.route.name !== "settings") return;
    document.getElementById(pendingAnchor)?.scrollIntoView({ block: "start" });
    setPendingAnchor(null);
  }, [pendingAnchor, router.route.name]);

  const value: AppContextValue = useMemo(
    () => ({ adapters, catalog, settings, updateSettings, license, setLicense, gate, scan, router, aiUsable, ai, capabilities, refreshCapabilities }),
    [settings, updateSettings, license, gate, scan, router, aiUsable, ai, capabilities, refreshCapabilities],
  );

  if (!showShell) {
    return (
      <AppContext.Provider value={value}>
        <Welcome
          initial={settings.profile}
          onStart={(profile) => {
            updateSettings({ profile, onboarded: true });
            void scan.start();
          }}
          onSkip={() => updateSettings({ onboarded: true })}
        />
      </AppContext.Provider>
    );
  }

  const items: NavItem[] = [
    { name: "overview", label: "Overview" },
    { name: "findings", label: "Findings" },
    ...(aiUsable ? [{ name: "ask" as const, label: "Ask" }] : []),
  ];
  const current: NavKey = router.route.name === "finding" ? "findings" : router.route.name;

  return (
    <AppContext.Provider value={value}>
      <div className={inactive ? "shell window-inactive" : "shell"}>
        <Sidebar
          items={items}
          current={current}
          license={license}
          dimmed={scanning}
          onSelect={(name) => router.navigate(NAV_ROUTES[name])}
        />
        <div className="content">
          {scanning ? (
            <ScanningShell />
          ) : (
            <>
              <ScreenErrorBoundary
                resetKey={routeKey(router.route)}
                onRescan={() => void scan.start()}
                onSettings={() => router.navigate({ name: "settings" })}
              >
                <Screen launchKey={launchKey} />
              </ScreenErrorBoundary>
            </>
          )}
        </div>
      </div>
    </AppContext.Provider>
  );
}

function routeKey(route: Route): string {
  return route.name === "finding" ? `finding:${route.ruleId}` : route.name;
}

/** The content column during a check-up: the Cancel icon button lives in the toolbar so it is always above the fold. */
function ScanningShell() {
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
  return (
    <>
      <Toolbar
        title="Checking your Mac"
        actions={[{ label: cancelling ? "Cancelling" : "Cancel", icon: ICONS.close, onClick: cancel, disabled }]}
      />
      <Scanning pacer={pacer} report={report} />
    </>
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
  const { scan, router } = useApp();
  const report = lastReport(scan.scan);
  const rescan: ToolbarAction = { label: "Rescan", icon: ICONS.rescan, onClick: () => void scan.start() };
  switch (route.name) {
    case "overview":
      return (
        <Toolbar
          title="Overview"
          subtitle={report === null ? undefined : `Last check-up ${formatDateTime(report.scannedAt)}`}
          actions={[rescan]}
        />
      );
    case "findings":
      return (
        <Toolbar title="Findings" actions={[rescan]}>
          <div id="toolbar-slot" className="toolbar-slot" />
        </Toolbar>
      );
    case "finding":
      return <Toolbar back={{ label: "Findings", onClick: () => router.back() }} />;
    case "ask":
      return <Toolbar title="Ask" />;
    case "settings":
      return <Toolbar title="Settings" />;
  }
}

function Screen({ launchKey }: { launchKey: { current: string | null | undefined } }) {
  const { route, lastMove } = useApp().router;
  const host = useRef<HTMLDivElement>(null);
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

  return (
    <div ref={host} className="screen-host">
      <RouteToolbar route={route} />
      <Banners />
      {screenFor(route)}
    </div>
  );
}

/** Settings with the live AI and permission state. */
function SettingsRoute() {
  const { adapters: ports, ai, capabilities, refreshCapabilities, scan } = useApp();
  const { probe, availability } = ai;
  useEffect(() => {
    if (availability === null) void probe();
  }, [probe, availability]);
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
    />
  );
}

function screenFor(route: Route) {
  switch (route.name) {
    case "overview":
      return <Overview />;
    case "findings":
      return <Findings />;
    case "finding":
      return <FindingDetail ruleId={route.ruleId} />;
    case "ask":
      return <Ask />;
    case "settings":
      return <SettingsRoute />;
  }
}
