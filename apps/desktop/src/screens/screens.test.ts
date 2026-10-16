import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AiAvailability, Capabilities, Explanation, FixPlan, LicenseState, Rule, RuleCatalog, RuleId, SystemState } from "@talos/core";
import { ALL_UNAVAILABLE, DEV_MACHINE, HARDENED, MACOS_CATALOG, evaluate } from "@talos/core";
import { DEFAULT_SETTINGS, MAX_MODEL_ID_LENGTH } from "../settings";
import { AppContext } from "../app/context";
import { buildGate } from "../app/gate";
import type { Gate } from "../app/gate";
import { StatefulProvider, fakeAdapters, fakeContextValue, fakeFinding, fakePlan, fakeReport } from "../app/testing";
import type { ExplainerProvider } from "../settings";
import type { ExplainState, FixingState, LastRecheck, ReadyState, WatchingState } from "../scan/machine";
import type { PacerView, RowState } from "../scan/useScanPacer";
import { Scanning, PROMPTING_ROW_COPY } from "./Scanning";
import { SECTION_PROGRESS_LABELS } from "../app/labels";
import { Welcome } from "./Welcome";
import { Findings } from "./Findings";
import { FindingDetail } from "./FindingDetail";
import { Overview } from "./Overview";
import { AI_OFF_COPY, Ask, NEAR_LIMIT_NOTICE } from "./Ask";
import { AI_BADGE, AI_LOCKED_COPY, AI_UNAVAILABLE_COPY } from "../components/AiCard";
import { PASSWORD_SENTENCE, NO_PASSWORD_SENTENCE } from "../components/fix-copy";
import { Settings } from "./Settings";
import type { SettingsProps } from "./Settings";
import type { Adapters } from "../adapters";
import type { AppSettings } from "../settings";

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
    fix: {
      summary: "x",
      settingsPath: null,
      settingsPane: null,
      commands: [],
      steps: [],
      verify: null,
      effort: "two_minutes",
      sideEffects: "none",
      apply: { kind: "manual", watch: [], watchEvery: 0, reveal: null },
    },
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


const EMPTY_STATE = { schemaVersion: 1 as const, collectedAt: report.collectedAt, host: report.platform, sections: {} as never };

/** A ready state with no fix or watch running. */
function readyState(explain: ExplainState = { kind: "off" }, extra: Partial<ReadyState> = {}): ReadyState {
  return { kind: "ready", report, state: EMPTY_STATE, explain, lastRecheck: null, fixing: null, watching: null, ...extra };
}

/** fakeContextValue plus a probed on-device availability. */
function withAi(value: ReturnType<typeof fakeContextValue>, availability: AiAvailability | null) {
  return { ...value, ai: { ...value.ai, availability } };
}

const ROWS = (SECTIONS: Partial<Record<string, RowState>>): PacerView["rows"] => {
  const rows = {} as Record<string, RowState>;
  for (const key of Object.keys(report.sections)) rows[key] = SECTIONS[key] ?? "pending";
  return rows as PacerView["rows"];
};

function pacer(overrides: Partial<PacerView> = {}): PacerView {
  return { rows: ROWS({}), found: { attention: 0, review: 0 }, phase: "areas", progress: 0, revealed: 0, ...overrides };
}

describe("Scanning", () => {
  it("starts with every row pending, the bar at zero and nothing found", () => {
    render(createElement(Scanning, { pacer: pacer(), report: null }));
    expect(screen.getByText("Starting")).toBeTruthy();
    expect(screen.getByText("Nothing found yet")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(document.querySelectorAll(".progress-pending").length).toBe(17);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("labels a checking row by its progress label and a revealed row by its verdict", () => {
    const view = pacer({
      rows: ROWS({ diskEncryption: "attention", firewall: "fine", browsers: "unavailable", updates: "checking", ssh: "review" }),
      revealed: 3,
      found: { attention: 2, review: 1 },
      progress: 3 / 17,
    });
    const failing = fakeReport([
      fakeFinding({ ruleId: "TL-MAC-001", status: "fail", requires: ["diskEncryption"] }),
      fakeFinding({ ruleId: "TL-MAC-002", status: "fail", requires: ["diskEncryption"] }),
      fakeFinding({ ruleId: "TL-MAC-003", status: "review", requires: ["ssh"] }),
    ]);
    render(createElement(Scanning, { pacer: view, report: failing }));
    expect(screen.getByText(SECTION_PROGRESS_LABELS.updates)).toBeTruthy();
    expect(screen.getByText("Checking")).toBeTruthy();
    expect(screen.getByText("2 to look at")).toBeTruthy();
    expect(screen.getByText("1 worth a look")).toBeTruthy();
    expect(screen.getByText("Fine")).toBeTruthy();
    expect(screen.getByText("Couldn't check")).toBeTruthy();
    expect(screen.getByText("3 of 17 areas")).toBeTruthy();
    expect(screen.getByText("2 found so far, 1 worth a look")).toBeTruthy();
  });

  it("shows the Automation copy on the loginItems row only when it is prompting", () => {
    render(createElement(Scanning, { pacer: pacer({ rows: ROWS({ loginItems: "prompting" }) }), report: null }));
    expect(screen.getByText(PROMPTING_ROW_COPY)).toBeTruthy();
  });

  it("announces checkpoints only, and the preparing row dims the list", () => {
    const { rerender } = render(createElement(Scanning, { pacer: pacer({ revealed: 2 }), report: null }));
    expect(screen.getByRole("status").textContent).toBe("");
    rerender(createElement(Scanning, { pacer: pacer({ revealed: 6 }), report: null }));
    expect(screen.getByRole("status").textContent).toBe("6 of 17 areas");
    rerender(createElement(Scanning, { pacer: pacer({ revealed: 17, phase: "preparing", progress: 1 }), report: null }));
    expect(screen.getByRole("status").textContent).toBe("Preparing your report");
    expect(document.querySelector(".progress-dimmed")).not.toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });
});

describe("Welcome", () => {
  it("preselects the defaults, builds a profile from the controls, and can be skipped", () => {
    const onStart = vi.fn();
    const onSkip = vi.fn();
    render(createElement(Welcome, { initial: DEFAULT_SETTINGS.profile, onStart, onSkip }));
    expect((screen.getByLabelText("For myself") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Not very") as HTMLInputElement).checked).toBe(true);
    const switches = screen.getAllByRole("switch") as HTMLInputElement[];
    expect(switches.map((s) => s.checked)).toEqual([false, true]);
    fireEvent.click(screen.getByLabelText("As a freelancer"));
    fireEvent.click(screen.getByLabelText("Very"));
    fireEvent.click(screen.getByRole("switch", { name: /other people's data/ }));
    fireEvent.click(screen.getByRole("switch", { name: "This laptop leaves home" }));
    fireEvent.click(screen.getByRole("button", { name: "Start check-up" }));
    expect(onStart).toHaveBeenCalledWith({ role: "freelancer", technical: "high", handlesClientData: true, laptopLeavesHome: false });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("is one screen: the lead, four Reads and four Never reads lines, and the on-device footnote", () => {
    render(createElement(Welcome, { initial: DEFAULT_SETTINGS.profile, onStart: vi.fn(), onSkip: vi.fn() }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("A calm check-up for your Mac");
    expect(screen.getByText(/It changes a setting only when you ask it to, and tells you first\./)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Reads" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Never reads" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBe(8);
    expect(screen.getByText("What you type into macOS's own password dialog")).toBeTruthy();
    expect(screen.queryByText(/administrator password for/)).toBeNull();
    expect(screen.getByText(/written on this Mac by Apple Intelligence when it is available\. Nothing leaves your Mac\./)).toBeTruthy();
    expect(screen.queryByText(/Claude|ChatGPT|account|licence/i)).toBeNull();
  });
});

describe("Findings", () => {
  it("groups findings, filters by severity, and shows the AI order beside the groups", () => {
    const value = withAi(
      fakeContextValue({
        adapters: fakeAdapters(),
        license: VALID,
        gate: stubGate(true),
        catalog,
        scanState: readyState({ kind: "ready", byRule: {}, order: ["TL-MAC-002", "TL-MAC-001", "TL-MAC-003"], priority: { order: ["TL-MAC-002", "TL-MAC-001", "TL-MAC-003"], reasons: [], startWith: ["TL-MAC-002"] } }),
      }),
      "available",
    );
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.getByRole("heading", { name: /Needs fixing/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Worth a look/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Passed" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Suggested order" })).toBeTruthy();
    expect(screen.getByText("AI #2")).toBeTruthy();
    expect(screen.getByText("Start with")).toBeTruthy();
    const cardTitles = () => Array.from(document.querySelectorAll(".finding-card .finding-card-title")).map((n) => n.textContent);
    expect(cardTitles()).toEqual(["Your disk is not encrypted", "The firewall is off", "Stealth mode is off"]);
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "critical" } });
    expect(cardTitles()).toEqual(["Your disk is not encrypted"]);
    expect(value.router.replace).toHaveBeenCalledWith({ name: "findings", severity: "critical", category: "all" });
  });

  it("shows the fix-cost word on every card and no nested interactive element", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), catalog, scanState: { kind: "idle", report: null, last: report } });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    const card = document.querySelector('.finding-card[data-rule-id="TL-MAC-001"]') as HTMLElement;
    expect(card.tagName).toBe("ARTICLE");
    expect(card.querySelector(".finding-card-cost")?.textContent).toContain("Fix in app");
    expect(card.querySelectorAll("a, button").length).toBe(1);
    expect(screen.getByRole("link", { name: "Your disk is not encrypted" })).toBeTruthy();
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
    const base = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), catalog, scanState: { kind: "idle", report: null, last: report } });
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
  aiEnabled?: boolean;
  /** The probed on-device availability; undefined leaves it unprobed. */
  ai?: AiAvailability | null;
  developerMode?: boolean;
  fixing?: FixingState | null;
  watching?: WatchingState | null;
  capabilities?: Capabilities | null;
}) {
  const report = evaluate(input.state, MACOS_CATALOG, { now: NOW, os: "macos" });
  const value = fakeContextValue({
    adapters: fakeAdapters(),
    license: input.license,
    gate: buildGate(report, input.license),
    settings: {
      ...DEFAULT_SETTINGS,
      onboarded: true,
      developer: { ...DEFAULT_SETTINGS.developer, enabled: input.developerMode ?? false },
      explainer: { ...DEFAULT_SETTINGS.explainer, provider: input.provider ?? "apple", aiEnabled: input.aiEnabled ?? true },
    },
    scanState: {
      kind: "ready",
      report,
      state: input.state,
      explain: input.explain ?? { kind: "off" },
      lastRecheck: input.lastRecheck ?? null,
      fixing: input.fixing ?? null,
      watching: input.watching ?? null,
    },
  });
  return { ...withAi(value, input.ai === undefined ? "available" : input.ai), capabilities: input.capabilities ?? null };
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

  it("offers Suggest an order on the AI card and renders the order as Start with, Then, and the rest in points order", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID });
    const { rerender } = render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    fireEvent.click(screen.getByRole("button", { name: "Suggest an order" }));
    expect(value.scan.prioritise).toHaveBeenCalledTimes(1);
    const priority = { order: ["TL-MAC-002", "TL-MAC-001"] as RuleId[], reasons: [{ ruleId: "TL-MAC-002" as RuleId, reason: "Quick and worth it." }], startWith: ["TL-MAC-002"] as RuleId[] };
    const ready = readyContext({ state: DEV_MACHINE, license: VALID, explain: { kind: "ready", byRule: {}, order: ["TL-MAC-002", "TL-MAC-001"], priority } });
    rerender(createElement(AppContext.Provider, { value: ready }, createElement(Overview)));
    expect(screen.getByText("Start with")).toBeTruthy();
    expect(screen.getByText("Quick and worth it.")).toBeTruthy();
    expect(screen.getByText("Then")).toBeTruthy();
    expect(screen.getByText("Then, in points order")).toBeTruthy();
    expect(screen.getByText(AI_BADGE)).toBeTruthy();
  });

  it("shows the honest unavailable state for every user and the lock only when the model is available", () => {
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE, ai: "device_not_eligible" }) }, createElement(Overview)));
    expect(screen.getByText(AI_UNAVAILABLE_COPY.device_not_eligible)).toBeTruthy();
    expect(screen.queryByText(AI_LOCKED_COPY)).toBeNull();
    cleanup();
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE, ai: "available" }) }, createElement(Overview)));
    expect(screen.getByText(AI_LOCKED_COPY)).toBeTruthy();
    expect(screen.getByPlaceholderText("Paste your licence key")).toBeTruthy();
    cleanup();
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE, aiEnabled: false }) }, createElement(Overview)));
    expect(document.querySelector(".ai-card")).toBeNull();
  });

  it("probes availability lazily when the card mounts and re-probes after opening Apple Intelligence settings", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID, ai: null });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(value.ai.probe).toHaveBeenCalled();
    cleanup();
    const off = readyContext({ state: DEV_MACHINE, license: VALID, ai: "apple_intelligence_not_enabled" });
    render(createElement(AppContext.Provider, { value: off }, createElement(Overview)));
    fireEvent.click(screen.getByRole("button", { name: "Open Apple Intelligence settings" }));
    expect(off.adapters.openSettingsPane).toHaveBeenCalledWith("apple_intelligence");
    expect(off.ai.reprobe).toHaveBeenCalledWith(5000);
  });

  it("lists the next fixes by their problem headline with an inline action that previews the fix", () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.getByRole("link", { name: "Your disk is not encrypted" })).toBeTruthy();
    expect(screen.queryByText("Your disk is encrypted")).toBeNull();
    const card = document.querySelector('.finding-card[data-rule-id="TL-MAC-001"]') as HTMLElement;
    fireEvent.click(card.querySelector(".finding-card-action") as HTMLButtonElement);
    const apply = MACOS_CATALOG.rules.find((r) => r.id === "TL-MAC-001")?.fix.apply;
    if (apply?.kind === "in_app") expect(value.scan.previewFix).toHaveBeenCalledWith("TL-MAC-001", { kind: "none" });
    else if (apply?.kind === "deep_link") {
      expect(value.adapters.openSettingsPane).toHaveBeenCalledWith(apply.pane);
      expect(value.scan.startWatch).toHaveBeenCalledWith("TL-MAC-001");
    } else expect(value.router.navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-001" });
  });

  it("opens the confirmation sheet for the fix the scan state holds", () => {
    const plan: FixPlan = fakePlan({ ruleId: "TL-MAC-002", recheck: ["firewall"] });
    const fixing: FixingState = { plan, phase: "confirm", step: 0, of: 1, error: null, result: null };
    const value = readyContext({ state: DEV_MACHINE, license: VALID, fixing });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    const sheet = screen.getByRole("dialog");
    expect(sheet.textContent).toContain(PASSWORD_SENTENCE);
    fireEvent.click(screen.getByRole("button", { name: "Turn on…" }));
    expect(value.scan.applyFix).toHaveBeenCalledWith(undefined);
  });

  it("folds the checks that could not run into one card per reason, each leading to Findings", () => {
    const value = readyContext({ state: ALL_UNAVAILABLE, license: NONE });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.getByRole("heading", { name: "Nothing could be checked" })).toBeTruthy();
    expect(document.querySelector(".ai-card")).toBeNull();
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
    renderDetail(readyContext({ state: UNSIGNED_STATE, license: VALID }), "TL-MAC-019");
    expect(screen.getByText("Not available in this build")).toBeTruthy();
    expect(screen.getByText(/not signed, so macOS hides the list of network services/)).toBeTruthy();
    expect(screen.queryByText("Permission was denied")).toBeNull();
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    expect(screen.queryByRole("button", { name: "I've done this, check again" })).toBeNull();
    expect(document.querySelector(".ai-card")).toBeNull();
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

  it("leads a permission unknown with the permission card, and shows neither a lock nor a fix", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-028");
    expect(screen.queryByText("This fix is part of the full version")).toBeNull();
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Check again" })).toBeTruthy();
    expect(screen.queryByText("Done it?")).toBeNull();
    expect(screen.getByRole("button", { name: "Open Full Disk Access" })).toBeTruthy();
    const main = document.querySelector("main") as HTMLElement;
    expect(main.querySelector("header + .permission")).not.toBeNull();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID }), "TL-MAC-028");
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    expect(document.querySelector(".lock")).toBeNull();
    expect(screen.getByText(/Once the reason above has been dealt with/)).toBeTruthy();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-029");
    expect(screen.getByText("This fix is part of the full version")).toBeTruthy();
    expect(screen.getAllByPlaceholderText("Paste your licence key").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Done it?" })).toBeTruthy();
  });

  it("opens the pane and starts the watcher from the permission card", () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE });
    renderDetail(value, "TL-MAC-028");
    fireEvent.click(screen.getByRole("button", { name: "Open Full Disk Access" }));
    expect(value.adapters.openSettingsPane).toHaveBeenCalledWith("full_disk_access");
    expect(document.querySelector('[data-permission-state="watching"]')).not.toBeNull();
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

  it("leads the fix card with its action and the password caption", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID });
    renderDetail(value, "TL-MAC-002");
    const card = screen.getByRole("heading", { name: "How to fix it" }).closest("section") as HTMLElement;
    const action = card.querySelector(".fix-action-row button") as HTMLButtonElement;
    expect(action.textContent).toContain("Turn on…");
    expect(card.querySelector(".fix-action-caption")?.textContent).toBe("macOS will ask for your password.");
    fireEvent.click(action);
    expect(value.scan.previewFix).toHaveBeenCalledWith("TL-MAC-002", { kind: "none" });
  });

  it("shows the watching strip and then the passed strip with the time", () => {
    const watching: WatchingState = { ruleId: "TL-MAC-002", sections: ["firewall"], everyMs: 3000, startedAt: NOW, lastPollAt: null, passedAt: null };
    const { rerender } = renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, watching }), "TL-MAC-002");
    expect(screen.getByText(/Watching for the change/)).toBeTruthy();
    const passed = readyContext({ state: DEV_MACHINE, license: VALID, watching: { ...watching, passedAt: NOW } });
    rerender(createElement(AppContext.Provider, { value: passed }, createElement(FindingDetail, { ruleId: "TL-MAC-002" })));
    const strip = document.querySelector(".status-strip-passed") as HTMLElement;
    expect(strip.textContent).toMatch(/Now passes, checked at \d{2}:\d{2}/);
    expect(document.activeElement).toBe(strip);
  });

  it("keeps the passed strip once the watched rule has left the report", () => {
    const fixed: SystemState = { ...DEV_MACHINE, sections: { ...DEV_MACHINE.sections, firewall: HARDENED.sections.firewall } };
    const watching: WatchingState = { ruleId: "TL-MAC-002", sections: ["firewall"], everyMs: 3000, startedAt: NOW, lastPollAt: NOW, passedAt: NOW };
    renderDetail(readyContext({ state: fixed, license: VALID, watching }), "TL-MAC-002");
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    const strip = document.querySelector(".status-strip-passed") as HTMLElement;
    expect(strip.textContent).toMatch(/Now passes, checked at \d{2}:\d{2}/);
    expect(document.activeElement).toBe(strip);
  });

  it("reports the result of a recheck even when the status did not change", () => {
    const lastRecheck: LastRecheck = { key: "firewall", at: NOW };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, lastRecheck }), "TL-MAC-002");
    expect(screen.getByText(/^Checked again at \d{2}:\d{2}\. Still needs fixing\.$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "I've done this, check again" })).toBeTruthy();
  });

  it("keeps focus on the recheck button while it runs, then reads the result when the button goes away", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID });
    const { rerender } = renderDetail(value, "TL-MAC-002");
    const button = screen.getByRole("button", { name: "I've done this, check again" });
    button.focus();
    fireEvent.click(button);
    expect(value.scan.recheck).toHaveBeenCalledWith(["firewall"]);
    const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });
    const rechecking = { ...value, scan: { ...value.scan, scan: { kind: "rechecking" as const, report, state: DEV_MACHINE, key: "firewall" as const, explain: { kind: "off" as const }, watching: null } } };
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
    const status = document.querySelector(".recheck-result") as HTMLElement;
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

  it("streams the explanation field by field with a caret and a Stop button, then moves focus to it", () => {
    const from = { byRule: {}, order: null, priority: null };
    const running: ExplainState = { kind: "running", target: "TL-MAC-001", partial: { whyItMattersForYou: "Your disk holds" }, answerPartial: null, from };
    const value = readyContext({ state: DEV_MACHINE, license: VALID, explain: running });
    const { rerender } = renderDetail(value, "TL-MAC-001");
    expect(screen.getByText("Your disk holds")).toBeTruthy();
    expect(document.querySelector(".caret")).not.toBeNull();
    expect(screen.getByText("Writing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(value.scan.stopExplain).toHaveBeenCalled();
    const explanation: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Why for you.", whatCouldHappen: "What.", urgency: "today" };
    const ready: ExplainState = { kind: "ready", byRule: { "TL-MAC-001": explanation }, order: null, priority: null };
    rerender(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: VALID, explain: ready }) }, createElement(FindingDetail, { ruleId: "TL-MAC-001" })));
    expect(screen.getByText("Why for you.")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText(AI_BADGE)).toBeTruthy();
    expect(document.querySelector(".caret")).toBeNull();
    expect(document.activeElement).toBe(document.querySelector(".ai-card-host"));
  });

  it("keeps an explanation on screen while its section is read again", () => {
    const explanation: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Why for you.", whatCouldHappen: "What.", urgency: "today" };
    const explain: ExplainState = { kind: "ready", byRule: { "TL-MAC-001": explanation }, order: null, priority: null };
    const value = readyContext({ state: DEV_MACHINE, license: VALID, explain });
    const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });
    const rechecking = { ...value, scan: { ...value.scan, scan: { kind: "rechecking" as const, report, state: DEV_MACHINE, key: "ssh" as const, explain, watching: null } } };
    renderDetail(rechecking, "TL-MAC-001");
    expect(screen.getByText("Why for you.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Explain this for me" })).toBeNull();
  });

  it("does not steal focus when a finding opens with an explanation already cached", () => {
    const explanation: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Why for you.", whatCouldHappen: "What.", urgency: "today" };
    const ready: ExplainState = { kind: "ready", byRule: { "TL-MAC-001": explanation }, order: null, priority: null };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, explain: ready }), "TL-MAC-001");
    expect(document.activeElement).toBe(document.body);
  });

  it("marks an explainer failure as an alert with Try again", () => {
    const explain: ExplainState = { kind: "failed", reason: "timeout", target: "TL-MAC-002", byRule: {}, order: null, priority: null };
    const value = readyContext({ state: DEV_MACHINE, license: VALID, explain });
    renderDetail(value, "TL-MAC-002");
    expect(screen.getByRole("alert").textContent).toMatch(/took too long/);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(value.scan.explain).toHaveBeenCalledWith("TL-MAC-002");
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

  it("hides the AI card when AI is off and shows the model-not-ready state without a lock", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE, aiEnabled: false }), "TL-MAC-002");
    expect(document.querySelector(".ai-card")).toBeNull();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE, ai: "model_not_ready" }), "TL-MAC-002");
    expect(screen.getByText(AI_UNAVAILABLE_COPY.model_not_ready)).toBeTruthy();
    expect(screen.queryByText(AI_LOCKED_COPY)).toBeNull();
  });

  it("says when a rechecked item now passes", () => {
    const lastRecheck: LastRecheck = { key: "platformIntegrity", at: NOW };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, lastRecheck }), "TL-MAC-004");
    expect(screen.getByRole("heading", { name: "Checked again" })).toBeTruthy();
    expect((document.querySelector(".recheck-result") as HTMLElement).textContent).toMatch(/Now passes\.$/);
  });

  it("shows an explainer failure only on the finding that asked, and keeps earlier explanations", () => {
    const explanation: Explanation = { ruleId: "TL-MAC-001", whyItMattersForYou: "Why for you.", whatCouldHappen: "What.", urgency: "today" };
    const explain: ExplainState = { kind: "failed", reason: "timeout", target: "TL-MAC-002", byRule: { "TL-MAC-001": explanation }, order: null, priority: null };
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, explain }), "TL-MAC-001");
    expect(screen.getByText("Why for you.")).toBeTruthy();
    expect(screen.queryByText(/took too long/)).toBeNull();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, explain }), "TL-MAC-002");
    expect(screen.getByText(/took too long/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("renders the fix sheet states: user-level confirm, running, done with points, and an error with its actions", () => {
    const plan: FixPlan = fakePlan({ ruleId: "TL-MAC-002", needsPassword: false, lines: [{ text: "defaults write x", privilege: "user" }] });
    const confirm: FixingState = { plan, phase: "confirm", step: 0, of: 1, error: null, result: null };
    const { rerender } = renderDetail(readyContext({ state: DEV_MACHINE, license: VALID, fixing: confirm }), "TL-MAC-002");
    expect(screen.getByRole("dialog").textContent).toContain(NO_PASSWORD_SENTENCE);
    expect(screen.getByRole("button", { name: "Turn on" })).toBeTruthy();
    const show = (fixing: FixingState) =>
      rerender(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: VALID, fixing }) }, createElement(FindingDetail, { ruleId: "TL-MAC-002" })));
    show({ ...confirm, phase: "running", step: 1, of: 1 });
    expect(screen.getByText("Running (1 of 1)")).toBeTruthy();
    show({ ...confirm, phase: "rechecking" });
    expect(screen.getByText("Checking the result")).toBeTruthy();
    show({ ...confirm, phase: "done", result: "pass" });
    expect(screen.getByText(/^Done\. .*\+\d+ points\.$/)).toBeTruthy();
    show({ ...confirm, phase: "done", result: "still_failing" });
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    show({ ...confirm, phase: "failed", error: "wrong_password", step: 1 });
    expect(screen.getByRole("alert").textContent).toBe("macOS did not accept the password. Nothing was changed.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    const actionNames = () => Array.from(document.querySelectorAll(".sheet-actions button")).map((b) => b.textContent);
    expect(actionNames()).toEqual(["Try again", "Close"]);
    show({ ...confirm, phase: "failed", error: "precondition_changed", step: 0 });
    expect(actionNames()).toEqual(["Rescan"]);
  });
});

describe("Findings suggested order", () => {
  it("lets a licensed user ask for an AI order from the Findings screen", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.getByRole("heading", { name: "Suggested order" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suggest an order" }));
    expect(value.scan.prioritise).toHaveBeenCalledTimes(1);
  });

  it("locks the order behind the licence with the inline field, and shows a prioritise failure inline", () => {
    const locked = readyContext({ state: DEV_MACHINE, license: NONE });
    render(createElement(AppContext.Provider, { value: locked }, createElement(Findings)));
    const aside = screen.getByRole("heading", { name: "Suggested order" }).closest("aside") as HTMLElement;
    expect(aside.textContent).toContain(AI_LOCKED_COPY);
    expect(aside.querySelector("input")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Suggest an order" })).toBeNull();
    cleanup();
    const failed = readyContext({
      state: DEV_MACHINE,
      license: VALID,
      explain: { kind: "failed", reason: "network", target: "prioritise", byRule: {}, order: null, priority: null },
    });
    render(createElement(AppContext.Provider, { value: failed }, createElement(Findings)));
    expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the AI provider/);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows Thinking about the order with Stop while it runs, then moves focus to the order", () => {
    const from = { byRule: {}, order: null, priority: null };
    const running = readyContext({ state: DEV_MACHINE, license: VALID, explain: { kind: "running", target: "prioritise", partial: null, answerPartial: null, from } });
    const { rerender } = render(createElement(AppContext.Provider, { value: running }, createElement(Findings)));
    expect(screen.getByText("Thinking about the order")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(running.scan.stopExplain).toHaveBeenCalled();
    expect(running.scan.prioritise).not.toHaveBeenCalled();
    const priority = { order: ["TL-MAC-002", "TL-MAC-001"] as RuleId[], reasons: [], startWith: ["TL-MAC-002"] as RuleId[] };
    const ready = readyContext({ state: DEV_MACHINE, license: VALID, explain: { kind: "ready", byRule: {}, order: ["TL-MAC-002", "TL-MAC-001"], priority } });
    rerender(createElement(AppContext.Provider, { value: ready }, createElement(Findings)));
    expect(screen.getByText("Start with")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Suggested order" }));
  });

  it("hides the aside when AI is switched off", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID, aiEnabled: false });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.queryByRole("heading", { name: "Suggested order" })).toBeNull();
  });
});

describe("Ask", () => {
  it("says AI is off when the switch is off, and shows the unavailable card or the lock otherwise", () => {
    const off = fakeContextValue({
      adapters: fakeAdapters(),
      license: NONE,
      gate: stubGate(false),
      settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, aiEnabled: false } },
      scanState: { kind: "idle", report: null, last: report },
    });
    render(createElement(AppContext.Provider, { value: off }, createElement(Ask)));
    expect(screen.getByText(AI_OFF_COPY)).toBeTruthy();
    expect(screen.queryByLabelText("Your question")).toBeNull();
    cleanup();
    const notEligible = withAi(fakeContextValue({ adapters: fakeAdapters(), license: VALID, gate: stubGate(true), scanState: { kind: "idle", report: null, last: report } }), "device_not_eligible");
    render(createElement(AppContext.Provider, { value: notEligible }, createElement(Ask)));
    expect(screen.getByText(AI_UNAVAILABLE_COPY.device_not_eligible)).toBeTruthy();
    expect(screen.queryByLabelText("Your question")).toBeNull();
    cleanup();
    const locked = withAi(fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), scanState: { kind: "idle", report: null, last: report } }), "available");
    render(createElement(AppContext.Provider, { value: locked }, createElement(Ask)));
    expect(screen.getByText(AI_LOCKED_COPY)).toBeTruthy();
    expect(screen.getByPlaceholderText("Paste your licence key")).toBeTruthy();
    expect(screen.queryByLabelText("Your question")).toBeNull();
  });

  function askContext() {
    const value = withAi(
      fakeContextValue({ adapters: fakeAdapters(), license: VALID, gate: stubGate(true), scanState: { kind: "idle", report: null, last: report } }),
      "available",
    );
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

  it("streams the answer with a caret and a Stop button while the machine says ask is running", () => {
    const from = { byRule: {}, order: null, priority: null };
    const value = withAi(
      fakeContextValue({ adapters: fakeAdapters(), license: VALID, gate: stubGate(true), scanState: readyState({ kind: "running", target: "ask", partial: null, answerPartial: "Start with the", from }) }),
      "available",
    );
    render(createElement(StatefulProvider, { value }, createElement(Ask)));
    expect(screen.getByText("Start with the")).toBeTruthy();
    expect(document.querySelector(".chat-streaming .caret")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(value.scan.stopExplain).toHaveBeenCalled();
  });

  it("announces a failed answer as an alert, but not a cancel", async () => {
    const value = askContext();
    value.scan.ask = vi.fn(async () => ({ ok: false as const, reason: "network" as const }));
    render(createElement(StatefulProvider, { value }, createElement(Ask)));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "What first?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Could not reach the AI provider/));
    cleanup();
    const cancelled = askContext();
    cancelled.scan.ask = vi.fn(async () => ({ ok: false as const, reason: "cancelled" as const }));
    render(createElement(StatefulProvider, { value: cancelled }, createElement(Ask)));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "What first?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(cancelled.scan.ask).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Settings", () => {
  const caps: Capabilities = { fullDiskAccess: false, automation: "not_determined" };
  function settingsProps(overrides: Partial<SettingsProps> = {}): SettingsProps {
    return { aiAvailability: "available", onAiAction: vi.fn(), capabilities: caps, onPermission: vi.fn(), onBuy: vi.fn(), ...overrides };
  }
  function dev(provider: ExplainerProvider, explainer: Partial<AppSettings["explainer"]> = {}): AppSettings {
    return { ...DEFAULT_SETTINGS, onboarded: true, developer: { ...DEFAULT_SETTINGS.developer, enabled: true }, explainer: { ...DEFAULT_SETTINGS.explainer, provider, ...explainer } };
  }
  function mount(props: Partial<SettingsProps> = {}, input: { settings?: AppSettings; license?: LicenseState; adapters?: Adapters; stateful?: boolean } = {}) {
    const adapters = input.adapters ?? fakeAdapters();
    const value = fakeContextValue({ adapters, license: input.license ?? NONE, gate: stubGate(false), catalog, settings: input.settings, scanState: { kind: "idle", report: null, last: null } });
    const full = settingsProps(props);
    render(createElement(input.stateful ? StatefulProvider : AppContext.Provider, { value }, createElement(Settings, full)));
    return { value, adapters, props: full };
  }

  it("keeps the six sections in the design order", () => {
    mount();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Check-up", "AI explanations", "Permissions", "Licence", "Developer mode", "About"]);
  });

  it("drives the AI status line from the availability prop and its one button from onAiAction", () => {
    const { value, props } = mount({ aiAvailability: "apple_intelligence_not_enabled" });
    const toggle = screen.getByRole("switch", { name: "Explain findings with Apple Intelligence" }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByText("Needs Apple Intelligence")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Apple Intelligence settings" }));
    expect(props.onAiAction).toHaveBeenCalledWith("apple_intelligence_not_enabled");
    expect(screen.getByText(/Only the check-up results are used, never file names, paths or passwords\./)).toBeTruthy();
    fireEvent.click(toggle);
    expect(value.updateSettings).toHaveBeenCalledWith({ explainer: { ...value.settings.explainer, aiEnabled: false } });
    cleanup();
    mount({ aiAvailability: "device_not_eligible" });
    expect(screen.getByText("This Mac can't run it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again|Open Apple/ })).toBeNull();
    cleanup();
    mount({ aiAvailability: null });
    expect(screen.getByText("Checking")).toBeTruthy();
    cleanup();
    mount({ aiAvailability: "off" }, { settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, aiEnabled: false } } });
    expect(screen.queryByText("Off")).toBeNull();
    expect((screen.getByRole("switch", { name: "Explain findings with Apple Intelligence" }) as HTMLInputElement).checked).toBe(false);
  });

  it("collapses the profile to one line and expands the controls on Edit", () => {
    const { value } = mount({}, { settings: { ...DEFAULT_SETTINGS, onboarded: true, profile: { role: "freelancer", technical: "medium", handlesClientData: true, laptopLeavesHome: true } } });
    expect(screen.getByText("Freelancer, somewhat technical, client data, laptop leaves home")).toBeTruthy();
    expect(screen.queryByLabelText("As a freelancer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("As a freelancer") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Very"));
    expect(value.updateSettings).toHaveBeenCalledWith({ profile: { ...value.settings.profile, technical: "high" } });
  });

  it("shows a status pill per permission and an Open or Allow button driven by props", () => {
    const { props } = mount();
    expect(screen.getByText("Not granted")).toBeTruthy();
    expect(screen.getByText("Not asked yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Full Disk Access" }));
    expect(props.onPermission).toHaveBeenCalledWith("full_disk_access", "not_granted");
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(props.onPermission).toHaveBeenCalledWith("automation", "not_determined");
    cleanup();
    mount({ capabilities: { fullDiskAccess: true, automation: "denied" } });
    expect(screen.getByText("Granted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Full Disk Access" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Automation settings" })).toBeTruthy();
    cleanup();
    mount({ capabilities: { fullDiskAccess: null, automation: null } });
    expect(screen.getAllByText("Could not tell").length).toBe(2);
    cleanup();
    mount({ capabilities: null });
    expect(screen.getAllByText("Checking").length).toBe(2);
  });

  it("offers the inline licence field with the free line, then the licensed line with Remove", async () => {
    const adapters = fakeAdapters();
    adapters.license.install = vi.fn(async (key: string): Promise<LicenseState> => (key === "TL1.GOOD" ? VALID : { status: "invalid", reason: "signature" }));
    const { props } = mount({}, { adapters, stateful: true });
    expect(screen.getByText("Free: the three most valuable fixes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Buy a licence" }));
    expect(props.onBuy).toHaveBeenCalled();
    const input = screen.getByLabelText("Licence key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "TL1.WRONG" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The key is not signed by Talos Labs."));
    fireEvent.change(input, { target: { value: "TL1.GOOD" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText(/^Licensed, personal plan, 1 seat, updates until 2027-01-01/)));
    expect(screen.queryByLabelText("Licence key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByLabelText("Licence key")).toBeTruthy());
    expect(adapters.license.remove).toHaveBeenCalled();
  });

  it("hides the sub-switches and providers until Developer mode is on, and returns to the on-device provider when it is turned off", () => {
    const { value } = mount();
    const toggle = screen.getByRole("switch", { name: "Developer mode" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.queryByRole("switch", { name: "Show Terminal commands next to fixes" })).toBeNull();
    expect(screen.queryByLabelText("Claude API key")).toBeNull();
    fireEvent.click(toggle);
    expect(value.updateSettings).toHaveBeenCalledWith({ developer: { ...value.settings.developer, enabled: true }, explainer: value.settings.explainer });
    cleanup();
    const on = mount({}, { settings: dev("ollama") });
    expect((screen.getByRole("switch", { name: "Show Terminal commands next to fixes" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: "Show the plan expanded in fix sheets" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("On this Mac")).toBeTruthy();
    expect(screen.getByLabelText("Claude API key")).toBeTruthy();
    expect((screen.getByLabelText("Local Ollama") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Model name")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Show Terminal commands next to fixes" }));
    expect(on.value.updateSettings).toHaveBeenCalledWith({ developer: { ...on.value.settings.developer, showCommands: false } });
    fireEvent.click(screen.getByRole("switch", { name: "Developer mode" }));
    expect(on.value.updateSettings).toHaveBeenCalledWith({ developer: { ...on.value.settings.developer, enabled: false }, explainer: { ...on.value.settings.explainer, provider: "apple" } });
  });

  it("shows key status without the key, writes to the secret store, and moves focus to the field when Remove goes away", async () => {
    const adapters = fakeAdapters();
    mount({}, { adapters, settings: dev("claude") });
    await waitFor(() => expect(screen.getByText("not set")).toBeTruthy());
    const input = screen.getByLabelText("Anthropic API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "sk-ant-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("saved")).toBeTruthy());
    expect(adapters.secrets.set).toHaveBeenCalledWith("anthropic_api_key", "sk-ant-secret");
    expect(input.value).toBe("");
    expect(document.body.textContent).not.toContain("sk-ant-secret");
    const remove = screen.getByRole("button", { name: "Remove" });
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() => expect(screen.getByText("not set")).toBeTruthy());
    expect(adapters.secrets.delete).toHaveBeenCalledWith("anthropic_api_key");
    expect(document.activeElement).toBe(input);
  });

  it("caps model ids at 64 characters, marks a longer or malformed id invalid, and links the hint without an alert", () => {
    const long = `claude-${"a".repeat(MAX_MODEL_ID_LENGTH)}`;
    mount({}, { settings: dev("claude", { claudeModel: long }) });
    const input = screen.getByLabelText("Model id") as HTMLInputElement;
    expect(input.maxLength).toBe(MAX_MODEL_ID_LENGTH);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("claude-model-error");
    expect(document.getElementById("claude-model-error")?.textContent).toBe("Model ids look like claude-opus-5 and are at most 64 characters.");
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    mount({}, { settings: dev("ollama", { ollamaModel: "b".repeat(MAX_MODEL_ID_LENGTH + 1) }) });
    const name = screen.getByLabelText("Model name") as HTMLInputElement;
    expect(name.maxLength).toBe(MAX_MODEL_ID_LENGTH);
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("ollama-model-error")?.textContent).toContain(`at most ${MAX_MODEL_ID_LENGTH} characters`);
  });

  it("ends with the About section: versions, catalogue, edition, build date, licence id and tag, and the privacy sentence", () => {
    const license: LicenseState = {
      status: "valid",
      payload: { v: 1, lid: "01HXYZ", product: "talos-desktop", plan: "business", seats: 5, issuedAt: "2026-01-01", updatesUntil: "2027-01-01", tag: "cafebabe" },
    };
    mount({}, { license });
    expect(screen.getByText("9.9.9")).toBeTruthy();
    expect(screen.getByText("Test Benchmark")).toBeTruthy();
    expect(screen.getByText(__BUILD_DATE__)).toBeTruthy();
    expect(screen.getByText(/01HXYZ/)).toBeTruthy();
    expect(screen.getByText(/cafebabe/)).toBeTruthy();
    expect(screen.getByText("Nothing leaves this Mac. AI explanations are written here by Apple Intelligence.")).toBeTruthy();
    expect(screen.queryByText(/ChatGPT/)).toBeNull();
  });
});
