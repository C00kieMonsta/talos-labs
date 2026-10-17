import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import type { LicenseState, RuleId, ScanReport } from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, evaluate, freeFixRuleIds } from "@talos/core";
import { buildGate, watchActive } from "./gate";
import { AppContext } from "./context";
import type { AppContextValue } from "./context";
import { FindingDetail } from "../screens/FindingDetail";
import { Overview } from "../screens/Overview";
import { fakeAdapters, fakeContextValue } from "./testing";
import { DEFAULT_SETTINGS } from "../settings";

afterEach(cleanup);

const NONE: LicenseState = { status: "none" };
const VALID: LicenseState = {
  status: "valid",
  payload: {
    v: 1,
    lid: "01TEST",
    product: "talos-desktop",
    plan: "personal",
    seats: 1,
    issuedAt: "2026-10-15",
    updatesUntil: "2027-10-15",
    tag: "deadbeef",
  },
};

function devReport(): ScanReport {
  return evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
}

// From docs/RULES.md: fails are 001(20) 002(8) 003(2) 010(8) 011(2) 014(2) 022(8) 026(4) 029(8).
const EXPECTED_FREE: RuleId[] = ["TL-MAC-001", "TL-MAC-002", "TL-MAC-010"];
const EXPECTED_LOCKED: RuleId[] = ["TL-MAC-003", "TL-MAC-011", "TL-MAC-014", "TL-MAC-022", "TL-MAC-026", "TL-MAC-029"];
const REVIEW: RuleId[] = ["TL-MAC-017", "TL-MAC-023", "TL-MAC-025"];

describe("license gate on DEV_MACHINE", () => {
  it("core picks the three highest-point fails, ties by catalog order, then the review ids", () => {
    const free = freeFixRuleIds(devReport());
    expect(free.slice(0, 3)).toEqual(EXPECTED_FREE);
    expect([...free.slice(3)].sort()).toEqual([...REVIEW].sort());
  });

  it("unlicensed: exactly the three free fixes and every review finding are open", () => {
    const report = devReport();
    const gate = buildGate(report, NONE);
    const open = report.findings.filter((f) => !gate.fixLocked(f)).map((f) => f.ruleId);
    expect(open.sort()).toEqual([...EXPECTED_FREE, ...REVIEW].sort());
    for (const id of EXPECTED_LOCKED) {
      expect(gate.fixLocked({ ruleId: id, status: "fail" })).toBe(true);
    }
    expect(gate.fixLocked({ ruleId: "TL-MAC-028", status: "unknown" })).toBe(true);
    expect(gate.has("recheck")).toBe(false);
    expect(gate.has("watch")).toBe(false);
  });

  it("licensed: nothing is locked", () => {
    const report = devReport();
    const gate = buildGate(report, VALID);
    expect(report.findings.some((f) => gate.fixLocked(f))).toBe(false);
    expect(gate.has("all_fixes")).toBe(true);
    expect(gate.has("recheck")).toBe(true);
    expect(gate.has("watch")).toBe(true);
  });

  it("no explanation is ever locked: free, locked, review and unknown ids, with or without a report, licensed or not", () => {
    const ids: RuleId[] = [...EXPECTED_FREE, ...EXPECTED_LOCKED, ...REVIEW, "TL-MAC-028"];
    for (const gate of [buildGate(devReport(), NONE), buildGate(devReport(), VALID), buildGate(null, NONE), buildGate(null, VALID)]) {
      for (const id of ids) expect(gate.explainLocked(id), id).toBe(false);
    }
  });

  it("the watch is locked without a licence and open with one", () => {
    expect(buildGate(devReport(), NONE).watchLocked).toBe(true);
    expect(buildGate(null, NONE).watchLocked).toBe(true);
    expect(buildGate(devReport(), VALID).watchLocked).toBe(false);
    expect(buildGate(null, VALID).watchLocked).toBe(false);
  });

  it("watchActive needs the switch and the licence", () => {
    const on = { watch: { ...DEFAULT_SETTINGS.watch, enabled: true } };
    const off = { watch: { ...DEFAULT_SETTINGS.watch, enabled: false } };
    expect(watchActive(on, { watchLocked: false })).toBe(true);
    expect(watchActive(on, { watchLocked: true })).toBe(false);
    expect(watchActive(off, { watchLocked: false })).toBe(false);
    expect(watchActive(off, { watchLocked: true })).toBe(false);
  });
});

function renderDetail(ruleId: RuleId, license: LicenseState, developerMode = false) {
  const report = devReport();
  const value: AppContextValue = fakeContextValue({
    adapters: fakeAdapters(),
    license,
    gate: buildGate(report, license),
    settings: { ...DEFAULT_SETTINGS, onboarded: true, developer: { ...DEFAULT_SETTINGS.developer, enabled: developerMode } },
    scanState: { kind: "ready", report, state: DEV_MACHINE, explain: { kind: "off" }, lastRecheck: null, fixing: null, watching: null },
  });
  return render(createElement(AppContext.Provider, { value }, createElement(FindingDetail, { ruleId })));
}

describe("FindingDetail lock overlay", () => {
  it("shows the fix for a free finding when unlicensed", () => {
    renderDetail("TL-MAC-001", NONE);
    expect(screen.getByRole("heading", { name: "How to fix it" })).toBeTruthy();
    expect(screen.queryByText("This fix is part of the full version")).toBeNull();
    expect(screen.getByText("+20 points when fixed")).toBeTruthy();
  });

  it("locks the fix for a non-free failing finding when unlicensed", () => {
    renderDetail("TL-MAC-029", NONE);
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    expect(screen.getByText("This fix is part of the full version")).toBeTruthy();
  });

  it("never locks a review finding", () => {
    renderDetail("TL-MAC-023", NONE);
    expect(screen.getByRole("heading", { name: "How to fix it" })).toBeTruthy();
  });

  it("unlocks everything with a valid licence", () => {
    renderDetail("TL-MAC-029", VALID);
    expect(screen.getByRole("heading", { name: "How to fix it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I've done this, check again" })).toBeTruthy();
  });

  it("fills {path} in the rendered commands from path evidence in Developer mode", () => {
    renderDetail("TL-MAC-029", VALID, true);
    const commands = Array.from(document.querySelectorAll(".command code")).map((c) => c.textContent);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((c) => c !== null && !c.includes("{path}"))).toBe(true);
    expect(commands.some((c) => c?.includes("/Users/alice/.ssh/id_ed25519"))).toBe(true);
  });
});

describe("Overview next three fixes", () => {
  it("lists exactly the three free fixes in order", () => {
    const report = devReport();
    const value = fakeContextValue({
      adapters: fakeAdapters(),
      license: NONE,
      gate: buildGate(report, NONE),
      scanState: { kind: "idle", report: null, last: report },
    });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    const section = screen.getByRole("heading", { name: "Next three fixes" }).closest("section");
    expect(section).not.toBeNull();
    const titles = Array.from(section?.querySelectorAll(".finding-card-title") ?? []).map((n) => n.textContent);
    const expected = EXPECTED_FREE.map((id) => report.findings.find((f) => f.ruleId === id)?.headline);
    expect(titles).toEqual(expected);
    expect(screen.getByText("Incomplete")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Full Disk Access" })).toBeTruthy();
  });
});
