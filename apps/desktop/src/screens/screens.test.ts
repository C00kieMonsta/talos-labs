import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LicenseState, Rule, RuleCatalog } from "@talos/core";
import { DEFAULT_SETTINGS } from "../settings";
import { AppContext } from "../app/context";
import type { Gate } from "../app/gate";
import { fakeAdapters, fakeContextValue, fakeFinding, fakeReport } from "../app/testing";
import { pendingSections } from "../scan/machine";
import { Scanning } from "./Scanning";
import { Welcome } from "./Welcome";
import { Findings } from "./Findings";
import { Ask } from "./Ask";
import { Settings } from "./Settings";
import { About } from "./About";

afterEach(cleanup);

const NONE: LicenseState = { status: "none" };
const VALID: LicenseState = {
  status: "valid",
  payload: { v: 1, lid: "L", product: "talos-desktop", plan: "personal", seats: 1, issuedAt: "2026-01-01", updatesUntil: "2027-01-01", tag: "abcd1234" },
};

function stubGate(licensed: boolean): Gate {
  return { licensed, freeFixes: [], has: () => licensed, fixLocked: () => !licensed };
}

function rule(id: Rule["id"], title: string): Rule {
  return {
    id,
    title,
    severity: "low",
    category: "backup",
    cis: null,
    os: ["macos"],
    requires: ["backup"],
    evidenceKeys: [],
    evidenceVocabulary: {},
    explanation: "x",
    fix: { summary: "x", settingsPath: null, settingsPane: null, commands: [], steps: [], verify: null, effort: "two_minutes", sideEffects: "none" },
    evaluate: () => ({ status: "pass", evidence: [] }),
  };
}

const catalog: RuleCatalog = {
  version: "9.9.9",
  cisEdition: "Test Benchmark",
  rules: [rule("TL-MAC-001", "Your disk is encrypted"), rule("TL-MAC-002", "The firewall is on"), rule("TL-MAC-003", "Quiet to probes")],
};

const findings = [
  fakeFinding({ ruleId: "TL-MAC-001", status: "fail", title: "Your disk is encrypted", severity: "critical", category: "encryption", points: 20 }),
  fakeFinding({ ruleId: "TL-MAC-002", status: "fail", title: "The firewall is on", severity: "high", category: "network", points: 8 }),
  fakeFinding({ ruleId: "TL-MAC-003", status: "review", title: "Quiet to probes", severity: "info", category: "persistence" }),
];
const report = fakeReport(findings, ["TL-MAC-003"]);

describe("Scanning", () => {
  it("shows plain progress labels and lets the user cancel", () => {
    const sections = { ...pendingSections(), firewall: "ok" as const, browsers: "unavailable" as const };
    const onCancel = vi.fn();
    render(createElement(Scanning, { sections, onCancel }));
    expect(screen.getByText("Checking disk encryption")).toBeTruthy();
    expect(screen.getByText("Firewall")).toBeTruthy();
    expect(screen.getByText(": could not be checked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("Welcome", () => {
  it("produces a profile from the radios and toggle, and can be skipped", () => {
    const onStart = vi.fn();
    const onSkip = vi.fn();
    render(createElement(Welcome, { initial: DEFAULT_SETTINGS.profile, onStart, onSkip }));
    fireEvent.click(screen.getByLabelText("As a freelancer"));
    fireEvent.click(screen.getByLabelText("Very. Show me the commands."));
    fireEvent.click(screen.getByLabelText("Yes"));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Start check-up" }));
    expect(onStart).toHaveBeenCalledWith({ role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false });
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onSkip).toHaveBeenCalled();
  });
});

describe("Findings", () => {
  it("groups findings, filters by severity, and shows the AI order beside the groups", () => {
    const value = fakeContextValue({
      adapters: fakeAdapters(),
      license: NONE,
      gate: stubGate(false),
      catalog,
      scanState: {
        kind: "ready",
        report,
        state: { schemaVersion: 1, collectedAt: report.collectedAt, host: report.platform, sections: {} as never },
        explain: { kind: "ready", byRule: {}, order: ["TL-MAC-002", "TL-MAC-001", "TL-MAC-003"] },
      },
    });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.getByRole("heading", { name: /Needs fixing/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Worth a look/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Passed" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Suggested order" })).toBeTruthy();
    expect(screen.getByText("AI #2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } });
    expect(screen.getByRole("button", { name: /Your disk is encrypted\. Open details/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /The firewall is on\. Open details/ })).toBeNull();
  });
});

describe("Ask", () => {
  it("is hidden when the provider is none", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), scanState: { kind: "idle", report: null, last: report } });
    render(createElement(AppContext.Provider, { value }, createElement(Ask)));
    expect(screen.getByText(/Choose an AI provider/)).toBeTruthy();
  });

  it("caps the question at 2000 characters and renders the answer as text", async () => {
    const value = fakeContextValue({
      adapters: fakeAdapters(),
      license: VALID,
      gate: stubGate(true),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude" } },
      scanState: { kind: "idle", report: null, last: report },
    });
    value.scan.ask = vi.fn(async () => ({ ok: true as const, value: { answer: "<b>Start</b> with the disk.", relatedRuleIds: ["TL-MAC-001" as const], outsideScope: false } }));
    render(createElement(AppContext.Provider, { value }, createElement(Ask)));
    const box = screen.getByLabelText("Your question") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(2000);
    fireEvent.change(box, { target: { value: "x".repeat(2500) } });
    expect(box.value.length).toBe(2000);
    fireEvent.change(box, { target: { value: "What first?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("<b>Start</b> with the disk.")).toBeTruthy());
    expect(document.querySelector(".chat b")).toBeNull();
    expect(screen.getByRole("button", { name: "Your disk is encrypted" })).toBeTruthy();
  });
});

describe("Settings", () => {
  it("shows key status without the key, writes to the secret store, and reports Full Disk Access", async () => {
    const adapters = fakeAdapters();
    const value = fakeContextValue({
      adapters,
      license: NONE,
      gate: stubGate(false),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude" } },
      scanState: { kind: "idle", report: null, last: null },
    });
    render(createElement(AppContext.Provider, { value }, createElement(Settings)));
    await waitFor(() => expect(screen.getByText("not set")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("not granted")).toBeTruthy());
    const input = screen.getByLabelText("Anthropic API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "sk-ant-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("saved")).toBeTruthy());
    expect(adapters.secrets.set).toHaveBeenCalledWith("anthropic_api_key", "sk-ant-secret");
    expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain("sk-ant-secret");
    fireEvent.click(screen.getAllByRole("button", { name: "Open" })[0] as HTMLElement);
    expect(adapters.openSettingsPane).toHaveBeenCalledWith("full_disk_access");
  });
});

describe("About", () => {
  it("shows versions, catalogue, edition, build date and licence details", () => {
    const license: LicenseState = {
      status: "valid",
      payload: { v: 1, lid: "01HXYZ", product: "talos-desktop", plan: "business", seats: 5, issuedAt: "2026-01-01", updatesUntil: "2027-01-01", tag: "cafebabe" },
    };
    const value = fakeContextValue({ adapters: fakeAdapters(), license, gate: stubGate(true), catalog, scanState: { kind: "idle", report: null, last: null } });
    render(createElement(AppContext.Provider, { value }, createElement(About)));
    expect(screen.getByText("9.9.9")).toBeTruthy();
    expect(screen.getByText("Test Benchmark")).toBeTruthy();
    expect(screen.getByText(__BUILD_DATE__)).toBeTruthy();
    expect(screen.getByText(/01HXYZ/)).toBeTruthy();
    expect(screen.getByText(/cafebabe/)).toBeTruthy();
  });
});
