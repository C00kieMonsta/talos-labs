// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Capabilities, UnavailableProbe } from "@talos/core";
import { PROBE_IDS } from "@talos/core";
import type { AppContextValue } from "../../app/context";
import { WATCH_PROBE_LABELS } from "../../app/labels";
import { StatefulProvider, fakeAdapters, fakeContextValue, fakeWatchState } from "../../app/testing";
import { DEFAULT_SETTINGS } from "../../settings";
import type { AppSettings } from "../../settings";
import type { WatchController } from "../../watch/watch-controller";
import { INERT_WATCH, WatchControllerContext } from "../../watch/watch-controller";
import { COVERAGE_EXPERTS } from "../coverage-experts";
import { COVERAGE } from "../copy";
import { BROWSER_ADDONS_ROW, COVERAGE_GROUPS, COVERED_PROBE_IDS, CoverageRoute, CoverageScreen, LOGIN_ITEMS_ROW, OUTSIDE_SWEEP, coverageModel, isSignedBuild } from "./CoverageScreen";

afterEach(cleanup);

const UNSIGNED: readonly UnavailableProbe[] = [{ probeId: "probe.listeners", reason: "unsigned_build" }];
const LICENSED_GATE = { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false };
const FREE_GATE = { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: true };

function baseInput(over: Partial<Parameters<typeof coverageModel>[0]> = {}) {
  return { licensed: true, enabled: true, everyMinutes: 15, unavailable: UNSIGNED, signedBuild: false, fullDiskAccess: false, ...over };
}

function renderCoverage(input: { licensed?: boolean; watch?: Partial<WatchController>; capabilities?: Capabilities | null; settings?: Partial<AppSettings["watch"]>; route?: boolean } = {}) {
  const licensed = input.licensed ?? true;
  const settings: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, watch: { ...DEFAULT_SETTINGS.watch, ...input.settings } };
  const value: AppContextValue = { ...fakeContextValue({ adapters: fakeAdapters(), license: { status: licensed ? "valid" : "none" } as never, gate: licensed ? LICENSED_GATE : FREE_GATE, scanState: { kind: "idle", last: null }, settings }), capabilities: input.capabilities ?? null };
  const watch: WatchController = { ...INERT_WATCH, state: fakeWatchState({ licensed, unavailable: UNSIGNED, everyMinutes: 15 }), ...input.watch };
  render(createElement(StatefulProvider, { value }, createElement(WatchControllerContext.Provider, { value: watch }, createElement(input.route === true ? CoverageRoute : CoverageScreen))));
  return { value, watch };
}

function rowTexts(): string[] {
  return Array.from(document.querySelectorAll(".coverage-group .coverage-row")).map((el) => el.textContent ?? "");
}

describe("coverageModel", () => {
  it("lists every probe exactly once across the five groups, in the Contract order, with the login-items row last under malware", () => {
    expect([...COVERED_PROBE_IDS].sort()).toEqual([...PROBE_IDS].sort());
    expect(new Set(COVERED_PROBE_IDS).size).toBe(PROBE_IDS.length);
    expect(Object.keys(COVERAGE_GROUPS)).toEqual(Object.keys(COVERAGE.groups));
    expect(OUTSIDE_SWEEP).toEqual(["probe.library_apps"]);
    const model = coverageModel(baseInput());
    expect(model.groups.map((g) => g.key)).toEqual(["firewalls", "settings", "access", "malware", "updates"]);
    expect(model.groups.map((g) => g.title)).toEqual(Object.values(COVERAGE.groups));
    const malware = model.groups[3];
    expect(malware?.rows.at(-1)).toEqual({ label: LOGIN_ITEMS_ROW, note: COVERAGE.fewTimesADay });
    expect(malware?.rows.find((r) => r.label === WATCH_PROBE_LABELS["probe.library_apps"])?.note).toBe(COVERAGE.fewTimesADay);
    const labels = model.groups.flatMap((g) => g.rows.map((r) => r.label));
    for (const probeId of PROBE_IDS) expect(labels.filter((l) => l === WATCH_PROBE_LABELS[probeId])).toHaveLength(1);
  });

  it("the intro reads the interval word, falls back to hour, and swaps for the off and unlicensed lines", () => {
    expect(coverageModel(baseInput({ everyMinutes: 15 })).intro).toBe("I look at these every 15 minutes, from the menu bar. I compare each one with how it was last time.");
    expect(coverageModel(baseInput({ everyMinutes: 60 })).intro).toContain("every hour,");
    expect(coverageModel(baseInput({ everyMinutes: 240 })).intro).toContain("every 4 hours,");
    expect(coverageModel(baseInput({ everyMinutes: 30 })).intro).toContain("every hour,");
    const off = coverageModel(baseInput({ enabled: false }));
    expect(off.intro).toBe(COVERAGE.introOff);
    expect(off.turnOn).toBe(true);
    const free = coverageModel(baseInput({ licensed: false, enabled: false }));
    expect(free.intro).toBe(COVERAGE.introUnlicensed);
    expect(free.turnOn).toBe(false);
    expect(coverageModel(baseInput()).turnOn).toBe(false);
  });

  it("an unavailable probe carries its reason, spotlight_off included; the gaps follow the build and Full Disk Access", () => {
    const model = coverageModel(baseInput({ unavailable: [...UNSIGNED, { probeId: "probe.library_apps", reason: "spotlight_off" }] }));
    const firewalls = model.groups[0];
    expect(firewalls?.rows.find((r) => r.label === "network services")).toEqual({ label: "network services", note: "needs a signed build" });
    expect(model.groups[3]?.rows.find((r) => r.label === WATCH_PROBE_LABELS["probe.library_apps"])?.note).toBe("Spotlight is off");
    expect(model.gaps).toEqual(["sockets", "browsers", "btm", "realtime", "privacy"]);
    expect(coverageModel(baseInput({ unavailable: [], signedBuild: true })).gaps).toEqual(["browsers", "btm", "realtime", "privacy"]);
    const fda = coverageModel(baseInput({ fullDiskAccess: true }));
    expect(fda.gaps).toEqual(["sockets", "btm", "realtime", "privacy"]);
    expect(fda.groups[1]?.rows.at(-1)).toEqual({ label: BROWSER_ADDONS_ROW, note: COVERAGE.fewTimesADay });
    expect(coverageModel(baseInput()).groups[1]?.rows.some((r) => r.label === BROWSER_ADDONS_ROW)).toBe(false);
    expect(isSignedBuild(UNSIGNED)).toBe(false);
    expect(isSignedBuild([])).toBe(true);
    expect(isSignedBuild([{ probeId: "probe.hosts", reason: "timeout" }])).toBe(true);
  });
});

describe("CoverageScreen", () => {
  it("draws every probe label once, the five h2, the reason in brackets, the five gaps, the disclosure, no primary and no link", () => {
    renderCoverage();
    expect(screen.getByText("I look at these every 15 minutes, from the menu bar. I compare each one with how it was last time.")).toBeTruthy();
    const headings = Array.from(document.querySelectorAll(".coverage-group h2")).map((h) => h.textContent);
    expect(headings).toEqual(Object.values(COVERAGE.groups));
    const rows = rowTexts();
    for (const probeId of PROBE_IDS) expect(rows.filter((r) => r === WATCH_PROBE_LABELS[probeId] || r.startsWith(`${WATCH_PROBE_LABELS[probeId]} (`))).toHaveLength(1);
    expect(rows).toContain("network services (needs a signed build)");
    expect(rows).toContain(`${WATCH_PROBE_LABELS["probe.library_apps"]} (a few times a day)`);
    expect(rows).toContain("login items (a few times a day)");
    expect(document.querySelector(".coverage-row .coverage-reason")?.textContent).toBe(" (needs a signed build)");
    expect(document.querySelectorAll(".coverage-group > p").length).toBe(5);
    expect(screen.getByRole("heading", { level: 2, name: COVERAGE.cannot })).toBeTruthy();
    const gaps = Array.from(document.querySelectorAll("p.coverage-gap")).map((p) => p.textContent);
    expect(gaps).toEqual(Object.values(COVERAGE.gaps).map(([what, why]) => `${what} ${why}`));
    const experts = document.querySelector("details.coverage-experts") as HTMLDetailsElement;
    expect(experts.querySelector("summary")?.textContent).toBe(COVERAGE.experts);
    expect(experts.classList.contains("guided-explain")).toBe(false);
    expect(experts.open).toBe(false);
    for (const [key, text] of Object.entries(COVERAGE_EXPERTS)) expect(experts.textContent).toContain(`${COVERAGE.groups[key as keyof typeof COVERAGE.groups]} ${text}`);
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
    expect(document.querySelectorAll(".guided-link").length).toBe(0);
    expect(document.querySelectorAll("a").length).toBe(0);
    // Nothing red: the reason is a span in the row, never a severity cue.
    expect(document.querySelectorAll("[class*='sev-'], [class*='critical']").length).toBe(0);
  });

  it("a signed build hides the sockets gap and the bracket; Full Disk Access hides the browsers gap and adds the browser add-ons row", () => {
    renderCoverage({ watch: { state: fakeWatchState({ unavailable: [] }) }, capabilities: { fullDiskAccess: true, automation: "granted", bundled: true } });
    expect(document.querySelectorAll("p.coverage-gap").length).toBe(3);
    expect(document.body.textContent).not.toContain("Needs a signed build.");
    expect(document.body.textContent).not.toContain("needs a signed build");
    expect(document.body.textContent).not.toContain("Needs Full Disk Access.");
    expect(rowTexts()).toContain("browser add-ons (a few times a day)");
    cleanup();
    renderCoverage({ watch: { state: fakeWatchState({ unavailable: [] }) } });
    expect(document.querySelectorAll("p.coverage-gap").length).toBe(4);
    expect(rowTexts().some((r) => r.startsWith("browser add-ons"))).toBe(false);
  });

  it("licensed with the watch off: the off intro and the one Turn the watch on link, which opens Settings", () => {
    const { value } = renderCoverage({ watch: { state: fakeWatchState({ enabled: false, unavailable: UNSIGNED }) } });
    expect(screen.getByText(COVERAGE.introOff)).toBeTruthy();
    const links = document.querySelectorAll("button.guided-link");
    expect(links.length).toBe(1);
    expect(links[0]?.textContent).toBe(COVERAGE.turnOn);
    fireEvent.click(screen.getByRole("button", { name: COVERAGE.turnOn }));
    expect(value.router.navigate).toHaveBeenCalledWith({ name: "settings" });
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
  });

  it("without a licence: the unlicensed intro, no link, and the rows still drawn", () => {
    renderCoverage({ licensed: false, watch: { state: fakeWatchState({ licensed: false, enabled: false, unavailable: [] }) } });
    expect(screen.getByText(COVERAGE.introUnlicensed)).toBeTruthy();
    expect(document.querySelectorAll(".guided-link").length).toBe(0);
    expect(document.body.textContent).not.toContain("full version");
    expect(document.querySelectorAll(".coverage-group").length).toBe(5);
  });

  it("falls back to the settings cache before the watch has answered", () => {
    renderCoverage({ watch: { state: null }, settings: { enabled: true, everyMinutes: 240 } });
    expect(screen.getByText(/every 4 hours,/)).toBeTruthy();
    expect(document.querySelectorAll(".coverage-row .coverage-reason").length).toBe(2);
  });

  it("the route draws the shell with the title and one Back strip link that pops the router", () => {
    const { value } = renderCoverage({ route: true });
    expect(screen.getByRole("heading", { level: 1, name: COVERAGE.title })).toBeTruthy();
    const strip = Array.from(document.querySelectorAll(".guided-strip-link")).map((b) => b.textContent);
    expect(strip).toEqual([COVERAGE.back, "Details", "Settings"]);
    fireEvent.click(screen.getByRole("button", { name: COVERAGE.back }));
    expect(value.router.back).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
    expect(document.querySelector("main.guided .coverage")).not.toBeNull();
    expect(document.querySelector(".window-inactive")).toBeNull();
  });

  it("the whole screen carries no machine text and no banned word", () => {
    renderCoverage();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/[/\\]|\.plist|\bsig\.|\bprobe\./);
    expect(text).not.toMatch(/\b(finding|findings|severity|CIS|rule|rules|policy|configuration|SSH|launchd|plist|daemon|sudo|Terminal|TCC|stealth|sysadminctl|points)\b/);
  });
});

describe("openWatchSettings", () => {
  it("navigates to Settings and scrolls the Watch heading into view once it exists", async () => {
    vi.useFakeTimers();
    const heading = document.createElement("h2");
    heading.id = "watch-heading";
    heading.scrollIntoView = vi.fn();
    document.body.appendChild(heading);
    const { value } = renderCoverage({ watch: { state: fakeWatchState({ enabled: false }) } });
    fireEvent.click(screen.getByRole("button", { name: COVERAGE.turnOn }));
    expect(value.router.navigate).toHaveBeenCalledWith({ name: "settings" });
    vi.runAllTimers();
    expect(heading.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    heading.remove();
    vi.useRealTimers();
  });
});
