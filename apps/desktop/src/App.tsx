import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LicenseState, ScanReport } from "@talos/core";
import { AppContext, useApp } from "./app/context";
import type { AppContextValue } from "./app/context";
import { adapters, buildContext, catalog, loadSettings, runEngine, saveSettings } from "./app/container";
import { buildGate } from "./app/gate";
import { useRouter } from "./app/router";
import type { Route, RouteName } from "./app/router";
import { SCAN_ERROR_LABELS } from "./app/labels";
import { useScan } from "./scan/useScan";
import { lastReport } from "./scan/machine";
import type { AppSettings } from "./settings";
import { Nav } from "./components/Nav";
import type { NavItem } from "./components/Nav";
import { Welcome } from "./screens/Welcome";
import { Scanning } from "./screens/Scanning";
import { Overview } from "./screens/Overview";
import { Findings } from "./screens/Findings";
import { FindingDetail } from "./screens/FindingDetail";
import { Ask } from "./screens/Ask";
import { Settings } from "./screens/Settings";
import { About } from "./screens/About";

const NAV_ROUTES: Readonly<Record<Exclude<RouteName, "finding">, Route>> = {
  overview: { name: "overview" },
  findings: { name: "findings" },
  ask: { name: "ask" },
  settings: { name: "settings" },
  about: { name: "about" },
};

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [license, setLicense] = useState<LicenseState>({ status: "none" });
  const router = useRouter();

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

  const value: AppContextValue = useMemo(
    () => ({ adapters, catalog, settings, updateSettings, license, setLicense, gate, scan, router }),
    [settings, updateSettings, license, gate, scan, router],
  );

  if (!settings.onboarded) {
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

  if (scan.scan.kind === "collecting" || scan.scan.kind === "evaluating") {
    return (
      <AppContext.Provider value={value}>
        <Scanning sections={scan.scan.kind === "collecting" ? scan.scan.sections : null} onCancel={scan.cancel} />
      </AppContext.Provider>
    );
  }

  const aiOn = settings.explainer.provider !== "none";
  const items: NavItem[] = [
    { name: "overview", label: "Overview" },
    { name: "findings", label: "Findings" },
    ...(aiOn ? [{ name: "ask" as const, label: "Ask" }] : []),
    { name: "settings", label: "Settings" },
    { name: "about", label: "About" },
  ];
  const current: RouteName = router.route.name === "finding" ? "findings" : router.route.name;

  return (
    <AppContext.Provider value={value}>
      <div className="shell">
        <Nav
          items={items}
          current={current}
          onSelect={(name) => {
            if (name !== "finding") router.navigate(NAV_ROUTES[name]);
          }}
        />
        <div className="content">
          {scan.scan.kind === "failed" && (
            <div className="banner" role="status">
              {SCAN_ERROR_LABELS[scan.scan.error]}{" "}
              <button type="button" className="link-button" onClick={() => void scan.start()}>
                Try again
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
          <Screen />
        </div>
      </div>
    </AppContext.Provider>
  );
}

function routeKey(route: Route): string {
  return route.name === "finding" ? `finding:${route.ruleId}` : route.name;
}

function Screen() {
  const { route } = useApp().router;
  const host = useRef<HTMLDivElement>(null);
  const key = routeKey(route);

  // Move focus to the new screen's heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    const heading = host.current?.querySelector("h1");
    if (heading === null || heading === undefined) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [key]);

  return (
    <div ref={host} className="screen-host">
      {screenFor(route)}
    </div>
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
      return <Settings />;
    case "about":
      return <About />;
  }
}
