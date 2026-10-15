import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Explanation, LicenseState, Rule, RuleCatalog, RuleId, SystemState } from "@talos/core";
import { ALL_UNAVAILABLE, DEV_MACHINE, HARDENED, MACOS_CATALOG, evaluate } from "@talos/core";
import { DEFAULT_SETTINGS, MAX_MODEL_ID_LENGTH } from "../settings";
import { AppContext } from "../app/context";
import { buildGate } from "../app/gate";
import type { Gate } from "../app/gate";
import { StatefulProvider, fakeAdapters, fakeContextValue, fakeFinding, fakeReport } from "../app/testing";
import type { ExplainerProvider } from "../settings";
import { pendingSections } from "../scan/machine";
import type { ExplainState, LastRecheck } from "../scan/machine";
import { Scanning } from "./Scanning";
import { Welcome } from "./Welcome";
import { Findings } from "./Findings";
import { FindingDetail } from "./FindingDetail";
import { Overview } from "./Overview";
import { Ask, NEAR_LIMIT_NOTICE } from "./Ask";
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

function rule(id: Rule["id"], title: string, failTitle: string): Rule {
  return {
    id,
    title,
    failTitle,
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
  rules: [
    rule("TL-MAC-001", "Your disk is encrypted", "Your disk is not encrypted"),
    rule("TL-MAC-002", "The firewall is on", "The firewall is off"),
    rule("TL-MAC-003", "Quiet to probes", "Stealth mode is off"),
  ],
};

const findings = [
  fakeFinding({ ruleId: "TL-MAC-001", status: "fail", title: "Your disk is encrypted", headline: "Your disk is not encrypted", severity: "critical", category: "encryption", points: 20 }),
  fakeFinding({ ruleId: "TL-MAC-002", status: "fail", title: "The firewall is on", headline: "The firewall is off", severity: "high", category: "network", points: 8 }),
  fakeFinding({ ruleId: "TL-MAC-003", status: "review", title: "Quiet to probes", headline: "Stealth mode is off", severity: "info", category: "persistence" }),
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

  it("counts areas as done, not checked, since some may have been out of reach", () => {
    const sections = { ...pendingSections(), firewall: "ok" as const, browsers: "unavailable" as const, ssh: "unavailable" as const };
    render(createElement(Scanning, { sections, onCancel: vi.fn() }));
    expect(screen.getByText("3 of 17 areas done")).toBeTruthy();
    expect(screen.queryByText(/areas checked/)).toBeNull();
  });

  it("takes one Cancel click only and keeps the button in the header", () => {
    const onCancel = vi.fn();
    render(createElement(Scanning, { sections: pendingSections(), onCancel }));
    const button = screen.getByRole("button", { name: "Cancel" });
    expect(button.closest("header")).not.toBeNull();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.dblClick(button);
    expect(onCancel).toHaveBeenCalledTimes(1);
    const cancelling = screen.getByRole("button", { name: "Cancelling" });
    expect((cancelling as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Welcome", () => {
  it("produces a profile from the radios and toggle, and can be skipped", () => {
    const onStart = vi.fn();
    const onSkip = vi.fn();
    render(createElement(Welcome, { initial: DEFAULT_SETTINGS.profile, onStart, onSkip }));
    fireEvent.click(screen.getByLabelText("As a freelancer"));
    fireEvent.click(screen.getByLabelText("Very. Be precise and brief."));
    fireEvent.click(screen.getByLabelText("Yes"));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Start check-up" }));
    expect(onStart).toHaveBeenCalledWith({ role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false });
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("does not promise Terminal commands, which Developer mode controls, not the profile", () => {
    render(createElement(Welcome, { initial: DEFAULT_SETTINGS.profile, onStart: vi.fn(), onSkip: vi.fn() }));
    expect(screen.queryByText(/Show me the commands/)).toBeNull();
  });

  it("does not promise to never read the username, since home paths carry it", () => {
    render(createElement(Welcome, { initial: DEFAULT_SETTINGS.profile, onStart: vi.fn(), onSkip: vi.fn() }));
    expect(screen.queryByText(/username/i)).toBeNull();
    expect(screen.getByText("Your computer's name or your browsing history")).toBeTruthy();
  });

  it("says AI help uses the user's own account and sends only the results", () => {
    render(createElement(Welcome, { initial: DEFAULT_SETTINGS.profile, onStart: vi.fn(), onSkip: vi.fn() }));
    expect(screen.getByText(/opens in your own Claude or ChatGPT account/)).toBeTruthy();
    expect(screen.getByText(/Only the check-up results are sent, never file names, paths or passwords/)).toBeTruthy();
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
    const cardTitles = () => Array.from(document.querySelectorAll(".finding-card .finding-card-title")).map((n) => n.textContent);
    expect(cardTitles()).toEqual(["Your disk is not encrypted", "The firewall is off", "Stealth mode is off"]);
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } });
    expect(cardTitles()).toEqual(["Your disk is not encrypted"]);
    expect(value.router.replace).toHaveBeenCalledWith({ name: "findings", severity: "critical", category: "all" });
  });

  it("names each card by its visible content: severity, category, AI rank, headline and points", () => {
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
    const card = document.querySelector('.finding-card[data-rule-id="TL-MAC-001"]') as HTMLButtonElement;
    expect(card.getAttribute("aria-label")).toBeNull();
    expect(card.querySelector("h1, h2, h3, h4")).toBeNull();
    expect(screen.getByRole("button", { name: /Critical.*Encryption.*AI #2, AI suggestion, not verified.*Your disk is not encrypted.*\+20 points when fixed/s })).toBe(card);
    expect(document.querySelector(".badge-rank[title]")).toBeNull();
  });

  it("names each group heading with a spoken count", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), catalog, scanState: { kind: "idle", report: null, last: report } });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.getByRole("heading", { name: "Needs fixing, 2 items" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Worth a look, 1 item" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Couldn't check, 0 items" })).toBeTruthy();
    expect(document.getElementById("group-needs-fixing")?.querySelector(".count-inline")?.closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Needs fixing, 2 items" })).toBeTruthy();
  });

  it("underlines the passed title only, not the badge before it", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), catalog, scanState: { kind: "idle", report: null, last: report } });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    const row = document.querySelector(".passed-list .link-button") as HTMLButtonElement;
    expect(row.querySelector(".badge")).not.toBeNull();
    expect(row.querySelector(".passed-title")?.textContent).toBe("Quiet to probes");
  });

  it("does not blame the filters when nothing passed and none are set, and offers a way out when a filter hides everything", () => {
    const empty = fakeReport([fakeFinding({ ruleId: "TL-MAC-001", status: "fail", severity: "critical", category: "encryption", points: 20 })]);
    const base = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), catalog, scanState: { kind: "idle", report: null, last: empty } });
    render(createElement(AppContext.Provider, { value: base }, createElement(Findings)));
    expect(screen.getByText("No checks passed.")).toBeTruthy();
    expect(screen.queryByText(/match the filters/)).toBeNull();
    cleanup();
    const value = { ...base, router: { ...base.router, route: { name: "findings" as const, severity: "low" as const, category: "backup" as const } } };
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.getByText("Nothing matches these filters.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Needs fixing/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Passed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(value.router.replace).toHaveBeenCalledWith({ name: "findings", severity: "all", category: "all" });
    expect(screen.getByRole("heading", { name: /Needs fixing/ })).toBeTruthy();
    expect((screen.getByLabelText("Severity") as HTMLSelectElement).value).toBe("all");
    cleanup();
    const partial = { ...base, router: { ...base.router, route: { name: "findings" as const, severity: "critical" as const, category: "all" as const } } };
    render(createElement(AppContext.Provider, { value: partial }, createElement(Findings)));
    expect(screen.getByText("No passing checks match the filters.")).toBeTruthy();
  });

  it("starts from the filters carried on the route", () => {
    const base = fakeContextValue({
      adapters: fakeAdapters(),
      license: NONE,
      gate: stubGate(false),
      catalog,
      scanState: { kind: "idle", report: null, last: report },
    });
    const value = { ...base, router: { ...base.router, route: { name: "findings" as const, severity: "high" as const, category: "network" as const } } };
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect((screen.getByLabelText("Severity") as HTMLSelectElement).value).toBe("high");
    expect((screen.getByLabelText("Category") as HTMLSelectElement).value).toBe("network");
    const titles = Array.from(document.querySelectorAll(".finding-card .finding-card-title")).map((n) => n.textContent);
    expect(titles).toEqual(["The firewall is off"]);
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
  provider?: ExplainerProvider;
  assistant?: "claude" | "chatgpt";
  developerMode?: boolean;
}) {
  const report = evaluate(input.state, MACOS_CATALOG, { now: NOW, os: "macos" });
  return fakeContextValue({
    adapters: fakeAdapters(),
    license: input.license,
    gate: buildGate(report, input.license),
    settings: {
      ...DEFAULT_SETTINGS,
      onboarded: true,
      developerMode: input.developerMode ?? false,
      explainer: { ...DEFAULT_SETTINGS.explainer, provider: input.provider ?? "none", assistant: input.assistant ?? "claude" },
    },
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

  it("offers to explain the whole report in the chosen assistant and lets the user switch", async () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE, provider: "browser" });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    fireEvent.click(screen.getByRole("button", { name: "Explain my results in Claude" }));
    await waitFor(() => expect(value.adapters.openAssistant).toHaveBeenCalledTimes(1));
    const [assistant, prompt] = vi.mocked(value.adapters.openAssistant).mock.calls[0] as [string, string];
    expect(assistant).toBe("claude");
    expect(prompt).toContain("TL-MAC-001");
    expect(prompt.length).toBeLessThanOrEqual(6000);
    fireEvent.click(screen.getByRole("button", { name: "Use ChatGPT instead" }));
    expect(value.updateSettings).toHaveBeenCalledWith({ explainer: { ...value.settings.explainer, assistant: "chatgpt" } });
    cleanup();
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE, provider: "browser", assistant: "chatgpt" }) }, createElement(Overview)));
    expect(screen.getByRole("button", { name: "Explain my results in ChatGPT" })).toBeTruthy();
  });

  it("shows no AI card when the provider is none or in-app", () => {
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE, provider: "none" }) }, createElement(Overview)));
    expect(screen.queryByRole("heading", { name: "AI help" })).toBeNull();
    cleanup();
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude" }) }, createElement(Overview)));
    expect(screen.queryByRole("heading", { name: "AI help" })).toBeNull();
  });

  it("lists the next fixes by their problem headline", () => {
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE }) }, createElement(Overview)));
    expect(screen.getByRole("button", { name: /Your disk is not encrypted/ })).toBeTruthy();
    expect(screen.queryByText("Your disk is encrypted")).toBeNull();
  });

  it("folds the checks that could not run into one card per reason, each leading to Findings", () => {
    const value = readyContext({ state: ALL_UNAVAILABLE, license: NONE, provider: "browser" });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.getByRole("heading", { name: "Nothing could be checked" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "AI help" })).toBeNull();
    const report = evaluate(ALL_UNAVAILABLE, MACOS_CATALOG, { now: NOW, os: "macos" });
    const unknown = report.findings.filter((f) => f.status === "unknown");
    const isPermission = (r: string | null) => r === "needs_full_disk_access" || r === "needs_automation_permission";
    const permissions = new Set(unknown.map((f) => f.unknownReason).filter(isPermission));
    const reasons = new Set(unknown.map((f) => f.unknownReason).filter((r) => !isPermission(r)));
    const grid = screen.getByRole("heading", { name: "Couldn't check" }).closest("section")?.querySelector(".card-grid");
    const cards = Array.from(grid?.querySelectorAll(":scope > .card") ?? []);
    expect(cards.length).toBe(permissions.size + reasons.size);
    expect(cards.length).toBeLessThan(unknown.length);
    const reasonCards = cards.filter((card) => card.querySelector("h3")?.textContent !== "Full Disk Access" && card.querySelector("h3")?.textContent !== "Automation");
    expect(reasonCards.length).toBe(reasons.size);
    for (const card of reasonCards) {
      expect(card.textContent).toMatch(/Affects \d+ checks?:/);
      expect(card.querySelector("button")?.textContent).toBe("See in Findings");
    }
    fireEvent.click(screen.getAllByRole("button", { name: "See in Findings" })[0] as HTMLElement);
    expect(value.router.navigate).toHaveBeenCalledWith({ name: "findings" });
  });

  it("keeps a single Run check-up call to action when the last check-up failed and no report exists", () => {
    const base = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), scanState: { kind: "idle", report: null, last: null } });
    const value = { ...base, scan: { ...base.scan, scan: { kind: "failed" as const, error: "cancelled" as const, last: null } } };
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.getByRole("button", { name: "Run check-up" })).toBeTruthy();
    expect(screen.queryByText(/did not finish/)).toBeNull();
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

  it("keeps the generic permission_denied label and offers a recheck for a non-network section", () => {
    const state: SystemState = {
      ...DEV_MACHINE,
      sections: { ...DEV_MACHINE.sections, ssh: { status: "unavailable", reason: "permission_denied", detail: "read_dir: .ssh" } },
    };
    renderDetail(readyContext({ state, license: VALID }), "TL-MAC-029");
    expect(screen.getByText("Permission was denied")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Check again" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check this item again" })).toBeTruthy();
  });

  it("shows neither a lock nor a fix for a check that could not run, with or without a licence", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-028");
    expect(screen.queryByText("This fix is part of the full version")).toBeNull();
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Check again" })).toBeTruthy();
    expect(screen.queryByText("Done it?")).toBeNull();
    expect(screen.getByRole("button", { name: "Open Full Disk Access settings" })).toBeTruthy();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID }), "TL-MAC-028");
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    expect(document.querySelector(".lock")).toBeNull();
    expect(screen.getByRole("heading", { name: "Check again" })).toBeTruthy();
    expect(screen.getByText(/Once the reason above has been dealt with/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check this item again" })).toBeTruthy();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-029");
    expect(screen.getByText("This fix is part of the full version")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Done it?" })).toBeTruthy();
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
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("keeps focus on the recheck button while it runs, then reads the result when the button goes away", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID });
    const { rerender } = renderDetail(value, "TL-MAC-002");
    const button = screen.getByRole("button", { name: "I've done this, check again" });
    button.focus();
    fireEvent.click(button);
    expect(value.scan.recheck).toHaveBeenCalledWith(["firewall"]);
    const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });
    const rechecking = { ...value, scan: { ...value.scan, scan: { kind: "rechecking" as const, report, state: DEV_MACHINE, key: "firewall" as const, explain: { kind: "off" as const } } } };
    rerender(createElement(AppContext.Provider, { value: rechecking }, createElement(FindingDetail, { ruleId: "TL-MAC-002" })));
    const busy = screen.getByRole("button", { name: "Checking again" });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(busy.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(busy);
    fireEvent.click(busy);
    expect(value.scan.recheck).toHaveBeenCalledTimes(1);
    const fixed: SystemState = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } };
    const done = readyContext({ state: fixed, license: VALID, lastRecheck: { key: "firewall", at: NOW } });
    rerender(createElement(AppContext.Provider, { value: done }, createElement(FindingDetail, { ruleId: "TL-MAC-002" })));
    expect(screen.getByRole("heading", { name: "Checked again" })).toBeTruthy();
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Now passes\.$/);
    expect(document.activeElement).toBe(status);
  });

  it("renders enum evidence in plain words", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-026");
    expect(screen.getByText("Time Machine")).toBeTruthy();
    expect(screen.queryByText("time machine")).toBeNull();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-007");
    expect(screen.getByText("Not set (macOS default)")).toBeTruthy();
    expect(screen.queryByText("unset")).toBeNull();
    expect(screen.queryByText("true")).toBeNull();
  });

  it("keeps Explain this for me mounted while it runs and then moves focus to the explanation", () => {
    const running: ExplainState = { kind: "running", target: "TL-MAC-001" };
    const { rerender } = renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain: running }), "TL-MAC-001");
    const button = screen.getByRole("button", { name: "Explain this for me" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Writing an explanation for you.")).toBeTruthy();
    const explanation: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Why for you.", whatCouldHappen: "What.", urgency: "today" };
    const ready: ExplainState = { kind: "ready", byRule: { "TL-MAC-001": explanation }, order: null };
    rerender(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain: ready }) }, createElement(FindingDetail, { ruleId: "TL-MAC-001" })));
    expect(screen.getByText("Why for you.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "AI explanation" }));
  });

  it("keeps an explanation on screen while its section is read again", () => {
    const explanation: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Why for you.", whatCouldHappen: "What.", urgency: "today" };
    const explain: ExplainState = { kind: "ready", byRule: { "TL-MAC-001": explanation }, order: null };
    const value = readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain });
    const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });
    const rechecking = { ...value, scan: { ...value.scan, scan: { kind: "rechecking" as const, report, state: DEV_MACHINE, key: "ssh" as const, explain } } };
    renderDetail(rechecking, "TL-MAC-001");
    expect(screen.getByText("Why for you.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Explain this for me" })).toBeNull();
  });

  it("does not steal focus when a finding opens with an explanation already cached", () => {
    const explanation: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Why for you.", whatCouldHappen: "What.", urgency: "today" };
    const ready: ExplainState = { kind: "ready", byRule: { "TL-MAC-001": explanation }, order: null };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain: ready }), "TL-MAC-001");
    expect(document.activeElement).toBe(document.body);
  });

  it("marks an explainer failure as an alert", () => {
    const explain: ExplainState = { kind: "failed", reason: "timeout", target: "TL-MAC-002", byRule: {}, order: null };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain }), "TL-MAC-002");
    expect(screen.getByRole("alert").textContent).toMatch(/took too long/);
  });

  it("heads the page with the problem and names the check underneath", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-002");
    expect(screen.getByRole("heading", { level: 1, name: "The firewall is off" })).toBeTruthy();
    expect(screen.getByText("What we check: The firewall is on. Result: Needs fixing.")).toBeTruthy();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-004");
    expect(screen.queryByText(/What we check/)).toBeNull();
  });

  it("hides Terminal commands unless Developer mode is on", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID }), "TL-MAC-002");
    expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
    expect(document.querySelector(".command")).toBeNull();
    expect(screen.getByText("Switch Firewall on.")).toBeTruthy();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, developerMode: true }), "TL-MAC-002");
    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(screen.getByText(/socketfilterfw --setglobalstate on/)).toBeTruthy();
  });

  it("offers the browser hand-off for one finding and never the in-app card", async () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE, provider: "browser" });
    renderDetail(value, "TL-MAC-002");
    expect(screen.queryByRole("heading", { name: "AI explanation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Explain this in Claude" }));
    await waitFor(() => expect(value.adapters.openAssistant).toHaveBeenCalledTimes(1));
    const [assistant, prompt] = vi.mocked(value.adapters.openAssistant).mock.calls[0] as [string, string];
    expect(assistant).toBe("claude");
    expect(prompt).toContain("TL-MAC-002");
    fireEvent.click(screen.getByRole("button", { name: "Use ChatGPT instead" }));
    expect(value.updateSettings).toHaveBeenCalledWith({ explainer: { ...value.settings.explainer, assistant: "chatgpt" } });
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE, provider: "none" }), "TL-MAC-002");
    expect(screen.queryByRole("heading", { name: "AI help" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "AI explanation" })).toBeNull();
  });

  it("reports a failed hand-off without throwing", async () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE, provider: "browser" });
    vi.mocked(value.adapters.openAssistant).mockRejectedValueOnce("prompt too long");
    renderDetail(value, "TL-MAC-002");
    fireEvent.click(screen.getByRole("button", { name: "Explain this in Claude" }));
    await waitFor(() => expect(screen.getByText(/could not be opened/)).toBeTruthy());
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
    expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the AI provider/);
    expect(screen.getByRole("button", { name: "Suggest an order" })).toBeTruthy();
  });

  it("keeps Suggest an order mounted while it runs and then moves focus to the order", () => {
    const running = readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain: { kind: "running", target: "prioritise" } });
    const { rerender } = render(createElement(AppContext.Provider, { value: running }, createElement(Findings)));
    const button = screen.getByRole("button", { name: "Suggest an order" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Working out an order for you.")).toBeTruthy();
    fireEvent.click(button);
    expect(running.scan.prioritise).not.toHaveBeenCalled();
    const ready = readyContext({ state: DEV_MACHINE, license: VALID, provider: "claude", explain: { kind: "ready", byRule: {}, order: ["TL-MAC-002", "TL-MAC-001"] } });
    rerender(createElement(AppContext.Provider, { value: ready }, createElement(Findings)));
    expect(screen.getByText("From the AI, not verified. The groups on the left keep the severity order.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Suggested order" }));
  });

  it("hides the aside when no AI provider is set and no order exists", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.queryByRole("heading", { name: "Suggested order" })).toBeNull();
  });

  it("hides the aside for the browser hand-off, which has no return channel", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID, provider: "browser" });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.queryByRole("heading", { name: "Suggested order" })).toBeNull();
  });
});

describe("Ask", () => {
  it("is hidden when the provider is none or the browser hand-off", () => {
    for (const provider of ["none", "browser"] as const) {
      const value = fakeContextValue({
        adapters: fakeAdapters(),
        license: NONE,
        gate: stubGate(false),
        settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider } },
        scanState: { kind: "idle", report: null, last: report },
      });
      render(createElement(AppContext.Provider, { value }, createElement(Ask)));
      expect(screen.getByText(/needs a Claude API key or a local Ollama model/)).toBeTruthy();
      expect(screen.queryByLabelText("Your question")).toBeNull();
      cleanup();
    }
  });

  function askContext() {
    const value = fakeContextValue({
      adapters: fakeAdapters(),
      license: VALID,
      gate: stubGate(true),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude" } },
      scanState: { kind: "idle", report: null, last: report },
    });
    value.scan.ask = vi.fn(async () => ({ ok: true as const, value: { answer: "<b>Start</b> with the disk.", relatedRuleIds: ["TL-MAC-001" as const], outsideScope: false } }));
    return value;
  }

  it("caps the question at 2000 characters and renders the answer as text", async () => {
    const value = askContext();
    render(createElement(StatefulProvider, { value }, createElement(Ask)));
    const box = screen.getByLabelText("Your question") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(2000);
    fireEvent.change(box, { target: { value: "x".repeat(2500) } });
    expect(box.value.length).toBe(2000);
    fireEvent.change(box, { target: { value: "What first?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("<b>Start</b> with the disk.")).toBeTruthy());
    expect(document.querySelector(".chat b")).toBeNull();
    expect(screen.getByRole("button", { name: "Your disk is not encrypted" })).toBeTruthy();
  });

  it("reads the character count with the box and only speaks up near the limit", () => {
    const value = askContext();
    render(createElement(StatefulProvider, { value }, createElement(Ask)));
    const box = screen.getByLabelText("Your question") as HTMLTextAreaElement;
    const count = document.getElementById("question-count") as HTMLElement;
    expect(box.getAttribute("aria-describedby")).toBe("question-count");
    expect(count.getAttribute("aria-live")).toBeNull();
    expect(count.textContent).toBe("0 / 2000");
    const status = screen.getByRole("status");
    fireEvent.change(box, { target: { value: "Which first?" } });
    expect(count.textContent).toBe("12 / 2000");
    expect(status.textContent).toBe("");
    fireEvent.change(box, { target: { value: "x".repeat(1950) } });
    expect(status.textContent).toBe(NEAR_LIMIT_NOTICE);
    fireEvent.change(box, { target: { value: "x".repeat(1960) } });
    expect(status.textContent).toBe(NEAR_LIMIT_NOTICE);
  });

  it("keeps the conversation and the draft when the screen is left and reopened", async () => {
    const value = askContext();
    const { rerender } = render(createElement(StatefulProvider, { value }, createElement(Ask)));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "What first?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("<b>Start</b> with the disk.")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "and after that" } });
    rerender(createElement(StatefulProvider, { value }, null));
    expect(screen.queryByLabelText("Your question")).toBeNull();
    rerender(createElement(StatefulProvider, { value }, createElement(Ask)));
    expect(screen.getByText("<b>Start</b> with the disk.")).toBeTruthy();
    expect(screen.getByText("What first?")).toBeTruthy();
    expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).value).toBe("and after that");
  });

  it("keeps the question box focusable while the AI answers and returns focus to it afterwards", async () => {
    const value = askContext();
    let release: () => void = () => undefined;
    value.scan.ask = vi.fn(
      () =>
        new Promise<{ ok: true; value: { answer: string; relatedRuleIds: RuleId[]; outsideScope: boolean } }>((resolve) => {
          release = () => resolve({ ok: true, value: { answer: "Disk first.", relatedRuleIds: [], outsideScope: false } });
        }),
    );
    render(createElement(StatefulProvider, { value }, createElement(Ask)));
    const box = screen.getByLabelText("Your question") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "What first?" } });
    const ask = screen.getByRole("button", { name: "Ask" });
    ask.focus();
    fireEvent.click(ask);
    await waitFor(() => expect(screen.getByText("Thinking about your question.")).toBeTruthy());
    expect(box.disabled).toBe(false);
    expect(box.readOnly).toBe(true);
    expect((ask as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("form.ask-form")?.getAttribute("aria-busy")).toBe("true");
    release();
    await waitFor(() => expect(screen.getByText("Disk first.")).toBeTruthy());
    expect(document.activeElement).toBe(box);
    expect(box.readOnly).toBe(false);
  });

  it("announces a failed answer as an alert", async () => {
    const value = askContext();
    value.scan.ask = vi.fn(async () => ({ ok: false as const, reason: "network" as const }));
    render(createElement(StatefulProvider, { value }, createElement(Ask)));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "What first?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the AI provider/));
  });
});

describe("Settings", () => {
  it("shows key status without the key, writes to the secret store, and reports Full Disk Access", async () => {
    const adapters = fakeAdapters();
    const value = fakeContextValue({
      adapters,
      license: NONE,
      gate: stubGate(false),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, developerMode: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude" } },
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

  it("moves focus to the key field when Remove takes the button away", async () => {
    const adapters = fakeAdapters();
    adapters.secrets.get = vi.fn(async () => "sk-ant-stored");
    const value = fakeContextValue({
      adapters,
      license: NONE,
      gate: stubGate(false),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, developerMode: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude" } },
      scanState: { kind: "idle", report: null, last: null },
    });
    render(createElement(AppContext.Provider, { value }, createElement(Settings)));
    const remove = await screen.findByRole("button", { name: "Remove" });
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() => expect(screen.getByText("not set")).toBeTruthy());
    expect(adapters.secrets.delete).toHaveBeenCalledWith("anthropic_api_key");
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Anthropic API key"));
  });

  it("caps model ids at 64 characters in the inputs and marks a longer stored id invalid", () => {
    const long = `claude-${"a".repeat(MAX_MODEL_ID_LENGTH)}`;
    const value = fakeContextValue({
      adapters: fakeAdapters(),
      license: NONE,
      gate: stubGate(false),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, developerMode: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude", claudeModel: long } },
      scanState: { kind: "idle", report: null, last: null },
    });
    render(createElement(AppContext.Provider, { value }, createElement(Settings)));
    const input = screen.getByLabelText("Model id") as HTMLInputElement;
    expect(input.maxLength).toBe(MAX_MODEL_ID_LENGTH);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("claude-model-error")?.textContent).toContain(`at most ${MAX_MODEL_ID_LENGTH} characters`);
    cleanup();
    const ollama = fakeContextValue({
      adapters: fakeAdapters(),
      license: NONE,
      gate: stubGate(false),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, developerMode: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "ollama", ollamaModel: "b".repeat(MAX_MODEL_ID_LENGTH + 1) } },
      scanState: { kind: "idle", report: null, last: null },
    });
    render(createElement(AppContext.Provider, { value: ollama }, createElement(Settings)));
    const name = screen.getByLabelText("Model name") as HTMLInputElement;
    expect(name.maxLength).toBe(MAX_MODEL_ID_LENGTH);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("ollama-model-error")?.textContent).toContain(`at most ${MAX_MODEL_ID_LENGTH} characters`);
  });

  it("says what leaves the Mac for AI help without the phrase that could mean the results stay", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), scanState: { kind: "idle", report: null, last: null } });
    render(createElement(AppContext.Provider, { value }, createElement(Settings)));
    expect(screen.getByText(/File names, folder paths and file contents never leave this Mac\./)).toBeTruthy();
    expect(screen.queryByText(/written on your Mac/)).toBeNull();
  });

  it("offers the browser hand-off and Off to everyone, and keeps key and Ollama behind Developer mode", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), scanState: { kind: "idle", report: null, last: null } });
    render(createElement(AppContext.Provider, { value }, createElement(Settings)));
    const browser = screen.getByLabelText("Open in Claude or ChatGPT (uses your own account, no key needed)") as HTMLInputElement;
    expect(browser.checked).toBe(true);
    expect((screen.getByLabelText("Claude") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("ChatGPT")).toBeTruthy();
    expect(screen.getByLabelText("Off")).toBeTruthy();
    expect(screen.queryByLabelText("Claude API key")).toBeNull();
    expect(screen.queryByLabelText("Local Ollama")).toBeNull();
    expect(screen.queryByLabelText("Anthropic API key")).toBeNull();
    fireEvent.click(screen.getByLabelText("ChatGPT"));
    expect(value.updateSettings).toHaveBeenCalledWith({ explainer: { ...value.settings.explainer, assistant: "chatgpt" } });
    const toggle = screen.getByRole("switch", { name: "Developer mode" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.getByText("Shows Terminal commands next to fixes and unlocks API-key and local-model options for AI help.")).toBeTruthy();
    fireEvent.click(toggle);
    expect(value.updateSettings).toHaveBeenCalledWith({ developerMode: true, explainer: value.settings.explainer });
  });

  it("labels the Claude or ChatGPT choice as its own question under the browser option", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), scanState: { kind: "idle", report: null, last: null } });
    render(createElement(AppContext.Provider, { value }, createElement(Settings)));
    const group = screen.getByRole("group", { name: "Which assistant" });
    expect(group.tagName).toBe("FIELDSET");
    expect(group.classList.contains("sub-options")).toBe(true);
    expect(group.classList.contains("subsection")).toBe(false);
    expect(group.querySelectorAll("input[name='assistant']").length).toBe(2);
    expect(screen.getByText("Terminal commands are shown by Developer mode, above.")).toBeTruthy();
  });

  it("links the model id hint to its input without making it an alert", () => {
    const value = fakeContextValue({
      adapters: fakeAdapters(),
      license: NONE,
      gate: stubGate(false),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, developerMode: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude", claudeModel: "gpt-9" } },
      scanState: { kind: "idle", report: null, last: null },
    });
    render(createElement(AppContext.Provider, { value }, createElement(Settings)));
    const input = screen.getByLabelText("Model id") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("claude-model-error");
    expect(document.getElementById("claude-model-error")?.textContent).toBe("Model ids look like claude-opus-5 and are at most 64 characters.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces a rejected licence key, marks the field invalid, and moves focus when the licence changes", async () => {
    const adapters = fakeAdapters();
    adapters.license.install = vi.fn(async (key: string): Promise<LicenseState> => (key === "TL1.GOOD" ? VALID : { status: "invalid", reason: "signature" }));
    const value = fakeContextValue({ adapters, license: NONE, gate: stubGate(false), scanState: { kind: "idle", report: null, last: null } });
    render(createElement(StatefulProvider, { value }, createElement(Settings)));
    const input = screen.getByLabelText("Licence key") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("false");
    fireEvent.change(input, { target: { value: "TL1.WRONG" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The key is not signed by Talos Labs."));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("licence-error");
    expect(document.getElementById("licence-error")?.getAttribute("role")).toBe("alert");
    expect(screen.queryByText(/The stored key is not valid/)).toBeNull();
    expect(screen.getAllByText("The key is not signed by Talos Labs.").length).toBe(1);
    fireEvent.change(input, { target: { value: "TL1.GOOD" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText(/^Licensed: personal plan/)));
    fireEvent.click(screen.getByRole("button", { name: "Remove licence" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Licence key")));
  });

  it("shows the API key and Ollama options in Developer mode and falls back to the browser when it is turned off", () => {
    const value = fakeContextValue({
      adapters: fakeAdapters(),
      license: NONE,
      gate: stubGate(false),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, developerMode: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "ollama" } },
      scanState: { kind: "idle", report: null, last: null },
    });
    render(createElement(AppContext.Provider, { value }, createElement(Settings)));
    expect(screen.getByLabelText("Claude API key")).toBeTruthy();
    expect((screen.getByLabelText("Local Ollama") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Model name")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Developer mode" }));
    expect(value.updateSettings).toHaveBeenCalledWith({ developerMode: false, explainer: { ...value.settings.explainer, provider: "browser" } });
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

  it("names the Explain buttons as the one thing that sends results out, since they need no set-up", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), catalog, scanState: { kind: "idle", report: null, last: null } });
    render(createElement(AppContext.Provider, { value }, createElement(About)));
    expect(screen.getByText(/never sends anything from your Mac anywhere on its own\. The Explain buttons open your own Claude or ChatGPT account/)).toBeTruthy();
    expect(screen.queryByText(/set up yourself/)).toBeNull();
  });
});
