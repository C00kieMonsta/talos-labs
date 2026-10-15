import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Explanation, LicenseState, Rule, RuleCatalog, RuleId, SystemState } from "@talos/core";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { DEFAULT_SETTINGS } from "../settings";
import { AppContext } from "../app/context";
import { buildGate } from "../app/gate";
import type { Gate } from "../app/gate";
import { fakeAdapters, fakeContextValue, fakeFinding, fakeReport } from "../app/testing";
import { pendingSections } from "../scan/machine";
import type { ExplainState, LastRecheck } from "../scan/machine";
import { Scanning } from "./Scanning";
import { Welcome } from "./Welcome";
import { Findings } from "./Findings";
import { FindingDetail } from "./FindingDetail";
import { Overview } from "./Overview";
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

  it("does not promise to never read the username, since home paths carry it", () => {
    render(createElement(Welcome, { initial: DEFAULT_SETTINGS.profile, onStart: vi.fn(), onSkip: vi.fn() }));
    expect(screen.queryByText(/username/i)).toBeNull();
    expect(screen.getByText("Your computer's name or your browsing history")).toBeTruthy();
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
        lastRecheck: null,
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

const NOW = "2026-10-15T10:00:00.000Z";
const HIDDEN = { status: "unavailable" as const, reason: "permission_denied" as const, detail: "netstat: empty socket table" };
const SHARED = { ...HIDDEN, detail: "shared: listeners" };
/** The dev machine as an unsigned build sees it: the kernel withheld the socket table. */
const UNSIGNED_STATE: SystemState = {
  ...DEV_MACHINE,
  sections: { ...DEV_MACHINE.sections, listeners: HIDDEN, remoteAccess: SHARED, fileSharing: SHARED },
};
function readyContext(input: {
  state: SystemState;
  license: LicenseState;
  explain?: ExplainState;
  lastRecheck?: LastRecheck | null;
  provider?: "none" | "claude";
}) {
  const report = evaluate(input.state, MACOS_CATALOG, { now: NOW, os: "macos" });
  return fakeContextValue({
    adapters: fakeAdapters(),
    license: input.license,
    gate: buildGate(report, input.license),
    settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: input.provider ?? "none" } },
    scanState: { kind: "ready", report, state: input.state, explain: input.explain ?? { kind: "off" }, lastRecheck: input.lastRecheck ?? null },
  });
}

describe("Overview", () => {
  it("tells the user an incomplete score can only be lower, not higher", () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.getByText("Incomplete")).toBeTruthy();
    expect(screen.getByText(/real score may be lower than this/)).toBeTruthy();
    expect(screen.queryByText(/higher than it looks/)).toBeNull();
  });

  it("folds the socket-table findings into one card that explains the unsigned build", () => {
    const value = readyContext({ state: UNSIGNED_STATE, license: NONE });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.getByRole("heading", { name: "Network checks are unavailable in this build" })).toBeTruthy();
    expect(screen.getByText(/not signed, so macOS hides the list of network services/)).toBeTruthy();
    expect(screen.getByText(/Affects: .*Remote Login \(SSH\) is off/)).toBeTruthy();
    expect(screen.queryByText("Permission was denied")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Remote Login (SSH) is off" })).toBeNull();
  });

  it("keeps the generic reason for other permission_denied sections", () => {
    const state: SystemState = {
      ...DEV_MACHINE,
      sections: { ...DEV_MACHINE.sections, ssh: { status: "unavailable", reason: "permission_denied", detail: "read_dir: .ssh" } },
    };
    const value = readyContext({ state, license: NONE });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.queryByRole("heading", { name: "Network checks are unavailable in this build" })).toBeNull();
    expect(screen.getAllByText("Permission was denied").length).toBeGreaterThan(0);
  });
});

describe("FindingDetail", () => {
  function renderDetail(value: ReturnType<typeof readyContext>, ruleId: RuleId) {
    return render(createElement(AppContext.Provider, { value }, createElement(FindingDetail, { ruleId })));
  }

  it("explains the unsigned build and hides the fix, lock and recheck for a socket-table finding", () => {
    renderDetail(readyContext({ state: UNSIGNED_STATE, license: VALID, provider: "claude" }), "TL-MAC-019");
    expect(screen.getByText("Not available in this build")).toBeTruthy();
    expect(screen.getByText(/not signed, so macOS hides the list of network services/)).toBeTruthy();
    expect(screen.queryByText("Permission was denied")).toBeNull();
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I've done this, check again" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "AI explanation" })).toBeNull();
    expect(document.querySelector(".lock")).toBeNull();
  });

  it("keeps the generic permission_denied label and the fix for a non-network section", () => {
    const state: SystemState = {
      ...DEV_MACHINE,
      sections: { ...DEV_MACHINE.sections, ssh: { status: "unavailable", reason: "permission_denied", detail: "read_dir: .ssh" } },
    };
    renderDetail(readyContext({ state, license: VALID }), "TL-MAC-029");
    expect(screen.getByText("Permission was denied")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I've done this, check again" })).toBeTruthy();
  });

  it("frames the authored explanation by status so an unknown or passed check does not read as confirmed", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-028");
    expect(screen.getByText(/This check could not run, so nothing below has been confirmed/)).toBeTruthy();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-004");
    expect(screen.getByText("Passed")).toBeTruthy();
    expect(screen.getByText(/This check passed\./)).toBeTruthy();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-002");
    expect(screen.queryByText(/This check could not run/)).toBeNull();
    expect(screen.queryByText(/This check passed/)).toBeNull();
  });

  it("reports the result of a recheck even when the status did not change", () => {
    const lastRecheck: LastRecheck = { key: "firewall", at: NOW };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, lastRecheck }), "TL-MAC-002");
    expect(screen.getByRole("status").textContent).toMatch(/^Checked again at \d{2}:\d{2}\. Still needs fixing\.$/);
    expect(screen.getByRole("button", { name: "I've done this, check again" })).toBeTruthy();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, lastRecheck }), "TL-MAC-029");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says when a rechecked item now passes", () => {
    const lastRecheck: LastRecheck = { key: "platformIntegrity", at: NOW };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, lastRecheck }), "TL-MAC-004");
    expect(screen.getByRole("heading", { name: "Checked again" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Now passes\.$/);
  });

  it("shows an explainer failure only on the finding that asked, and keeps earlier explanations", () => {
    const explanation: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Why for you.", whatCouldHappen: "What.", urgency: "today" };
    const explain: ExplainState = { kind: "failed", reason: "timeout", target: "TL-MAC-002", byRule: { "TL-MAC-001": explanation }, order: null };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain }), "TL-MAC-001");
    expect(screen.getByText("Why for you.")).toBeTruthy();
    expect(screen.queryByText(/took too long/)).toBeNull();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain }), "TL-MAC-002");
    expect(screen.getByText(/took too long/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Explain this for me" })).toBeTruthy();
  });
});

describe("Findings suggested order", () => {
  it("lets a licensed user ask for an AI order from the Findings screen", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude" });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.getByRole("heading", { name: "Suggested order" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suggest an order" }));
    expect(value.scan.prioritise).toHaveBeenCalledTimes(1);
  });

  it("locks the order behind the licence and shows a prioritise failure inline", () => {
    const locked = readyContext({ state: DEV_MACHINE, license: NONE, provider: "claude" });
    render(createElement(AppContext.Provider, { value: locked }, createElement(Findings)));
    expect(screen.getByRole("region", { name: "An AI-suggested order is part of the full version" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Suggest an order" })).toBeNull();
    cleanup();
    const failed = readyContext({
      state: DEV_MACHINE,
      license: VALID,
      provider: "claude",
      explain: { kind: "failed", reason: "network", target: "prioritise", byRule: {}, order: null },
    });
    render(createElement(AppContext.Provider, { value: failed }, createElement(Findings)));
    expect(screen.getByText(/Could not reach the AI provider/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Suggest an order" })).toBeTruthy();
  });

  it("hides the aside when no AI provider is set and no order exists", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.queryByRole("heading", { name: "Suggested order" })).toBeNull();
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
