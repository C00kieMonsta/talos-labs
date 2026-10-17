import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import { createRequire } from "node:module";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AiAvailability, Capabilities, Explanation, FixPlan, LicenseState, Rule, RuleCatalog, RuleId, SystemState } from "@talos/core";
import { ALL_UNAVAILABLE, DEV_MACHINE, EMPTY_GUIDED_MEMORY, HARDENED, MACOS_CATALOG, evaluate } from "@talos/core";
import type { GuidedMemory } from "@talos/core";
import type { GuidedController } from "../guided/state";
import { ACCEPT, END } from "../guided/copy";
import { formatDate } from "../app/labels";
import { DEFAULT_SETTINGS, MAX_MODEL_ID_LENGTH } from "../settings";
import { AppContext } from "../app/context";
import { buildGate } from "../app/gate";
import type { Gate } from "../app/gate";
import { StatefulProvider, fakeAdapters, fakeConnectController, fakeContextValue, fakeFinding, fakePlan, fakeReport } from "../app/testing";
import type { ExplainerProvider } from "../settings";
import type { ExplainState, FixingState, LastRecheck, ReadyState, SingleFixingState, WatchingState } from "../scan/machine";
import type { PacerView, RowState } from "../scan/useScanPacer";
import { Scanning, PROMPTING_ROW_COPY } from "./Scanning";
import { SECTION_PROGRESS_LABELS } from "../app/labels";
const AI_BADGE = AI_BADGES.apple;
import { GUIDED_SECTION_LABELS, WATCH_SETTINGS } from "../guided/copy";
import { Welcome } from "./Welcome";
import { GuidedWelcome } from "../guided/GuidedWelcome";
import { NOT_ANTIVIRUS, WELCOME } from "../guided/copy";
import { fakeWatchController } from "../app/testing";
import { WatchControllerContext } from "../watch/watch-controller";
import { Findings } from "./Findings";
import { FindingDetail } from "./FindingDetail";
import { Overview } from "./Overview";
import { AI_UNAVAILABLE_COPY } from "../components/AiCard";
import { PASSWORD_SENTENCE, NO_PASSWORD_SENTENCE } from "../components/fix-copy";
import { DEV_BUILD_FDA_COPY, FREE_LINE, PAID_LINE, Settings, chatgptClientLine, claudeCodeLine } from "./Settings";
import type { SettingsProps } from "./Settings";
import { AI_ACTIONS, AI_BADGES, PRIVACY_SENTENCE, PRIVACY_SENTENCE_REMOTE, PROVIDER_NAMES, YOUR_AI, aiPillWord, providerLines } from "../app/labels";
import type { Adapters } from "../adapters";
import type { AppSettings } from "../settings";
import { INERT_CHAT_BRIDGE } from "../guided/testing";

afterEach(cleanup);

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

/** The fixed counter from DESIGN-V03.md section 6, as in guided/copy.test.ts. Errs long on purpose. */
function syllablesPerWord(text: string): number {
  const words = text
    .split(/\s+/)
    .filter((token) => /[a-z]/i.test(token))
    .map((token) => token.toLowerCase().replace(/[^a-z]/g, ""))
    .filter((word) => word.length > 0);
  if (words.length === 0) return 0;
  let total = 0;
  for (const word of words) {
    const runs = word.match(/[aeiouy]+/g)?.length ?? 0;
    let count = runs;
    if (runs > 1 && word.endsWith("e") && !word.endsWith("le")) count -= 1;
    total += Math.max(1, count);
  }
  return total / words.length;
}
const AXE_RULES = { runOnly: ["button-name", "nested-interactive", "aria-allowed-role", "aria-valid-attr-value", "label"] };

const NONE: LicenseState = { status: "none" };
const VALID: LicenseState = {
  status: "valid",
  payload: { v: 1, lid: "L", product: "talos-desktop", plan: "personal", seats: 1, issuedAt: "2026-01-01", updatesUntil: "2027-01-01", tag: "abcd1234" },
};

function stubGate(licensed: boolean): Gate {
  return { licensed, freeFixes: [], has: () => licensed, fixLocked: () => !licensed, explainLocked: () => false, watchLocked: !licensed };
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
    guided: { headline: failTitle, why: "It matters.", verb: "Details", done: "Done. Sorted.", where: null },
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

describe("Scanning (guided)", () => {
  it("counts things to fix, names checking rows with the guided labels, and draws a dot per row", () => {
    const view = pacer({
      rows: ROWS({ diskEncryption: "attention", firewall: "fine", browsers: "unavailable", ssh: "checking", dotfiles: "review" }),
      revealed: 3,
      found: { attention: 2, review: 1 },
      progress: 3 / 17,
    });
    render(createElement(Scanning, { pacer: view, report: null, guided: true }));
    expect(screen.getByText("2 things to fix so far")).toBeTruthy();
    expect(screen.queryByText(/found so far/)).toBeNull();
    expect(screen.getByText(GUIDED_SECTION_LABELS.ssh)).toBeTruthy();
    expect(screen.queryByText(SECTION_PROGRESS_LABELS.ssh)).toBeNull();
    expect(screen.queryByText("Checking")).toBeNull();
    expect(screen.queryByText("Couldn't check")).toBeNull();
    expect(document.querySelector(".progress-status")).toBeNull();
    expect(document.querySelectorAll(".scan-dot").length).toBe(17);
    expect(document.querySelector("[data-section='diskEncryption'] .scan-dot")?.className).toBe("scan-dot scan-dot-found");
    expect(document.querySelector("[data-section='firewall'] .scan-dot")?.className).toBe("scan-dot scan-dot-passed");
    expect(document.querySelector("[data-section='ssh'] .scan-dot")?.className).toBe("scan-dot scan-dot-active");
    expect(document.querySelector("[data-section='backup'] .scan-dot")?.className).toBe("scan-dot scan-dot-pending");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("reads one thing in the singular, nothing at zero, and moves the preparing line under the grid", () => {
    const { rerender } = render(createElement(Scanning, { pacer: pacer({ found: { attention: 1, review: 3 } }), report: null, guided: true }));
    expect(screen.getByText("1 thing to fix so far")).toBeTruthy();
    rerender(createElement(Scanning, { pacer: pacer({ found: { attention: 0, review: 3 } }), report: null, guided: true }));
    expect(screen.getByText("Nothing found yet")).toBeTruthy();
    rerender(createElement(Scanning, { pacer: pacer({ revealed: 17, phase: "preparing", progress: 1 }), report: null, guided: true }));
    expect(document.querySelector(".scan-summary .guided-status")?.textContent).toBe("Preparing your report");
    expect(document.querySelector(".scan-summary svg")).toBeNull();
    expect(document.querySelector(".progress-preparing")).toBeNull();
    expect(document.querySelector(".progress-dimmed")).not.toBeNull();
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

describe("GuidedWelcome", () => {
  function renderGuidedWelcome(licensed: boolean) {
    const watch = fakeWatchController();
    const value = fakeContextValue({ adapters: fakeAdapters(), license: licensed ? VALID : NONE, gate: stubGate(licensed), scanState: { kind: "idle", report: null, last: null }, settings: { ...DEFAULT_SETTINGS, onboarded: false } });
    render(createElement(AppContext.Provider, { value }, createElement(WatchControllerContext.Provider, { value: watch }, createElement(GuidedWelcome, { onStart: vi.fn() }))));
    fireEvent.click(screen.getByRole("button", { name: WELCOME.what }));
    return { watch };
  }

  it("unlicensed: the body says nothing about the watch, the two lists open, and no permission button is drawn", () => {
    const { watch } = renderGuidedWelcome(false);
    expect(screen.getByText(WELCOME.body)).toBeTruthy();
    expect(screen.queryByText(/menu bar/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Reads" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Never reads" })).toBeTruthy();
    expect(document.querySelector(".fishy-welcome-watch")).toBeNull();
    expect(screen.queryByText(NOT_ANTIVIRUS)).toBeNull();
    expect(screen.queryByRole("button", { name: WELCOME.allowNotifications })).toBeNull();
    expect(watch.requestNotifyPermission).not.toHaveBeenCalled();
  });

  it("licensed: the not-antivirus block and its button, which asks for the permission through the controller", async () => {
    const { watch } = renderGuidedWelcome(true);
    expect(document.querySelector(".fishy-welcome-watch")).not.toBeNull();
    expect(screen.getByText(NOT_ANTIVIRUS)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: WELCOME.allowNotifications }));
    await waitFor(() => expect(watch.requestNotifyPermission).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(watch.setNotify).toHaveBeenCalledWith(true));
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

  it("renders each passed check as one row with the badge and the title", () => {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), catalog, scanState: { kind: "idle", report: null, last: report } });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    const row = document.querySelector(".passed-list .finding-row") as HTMLButtonElement;
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
  until?: string | null;
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
  const probed = withAi(value, input.ai === undefined ? "available" : input.ai);
  return { ...probed, ai: { ...probed.ai, until: input.until ?? null }, capabilities: input.capabilities ?? null };
}

describe("Overview", () => {
  it("tells the user an incomplete score can only be lower, not higher", () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    const status = screen.getByText("Incomplete").closest("p") as HTMLElement;
    expect(status.getAttribute("title")).toMatch(/real score may be lower than this/);
    expect(screen.queryByText(/real score may be lower than this/)).toBeNull();
    expect(status.getAttribute("title")).not.toMatch(/higher than it looks/);
  });

  it("folds the socket-table findings into one card that explains the unsigned build", () => {
    const value = readyContext({ state: UNSIGNED_STATE, license: NONE });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.getByRole("heading", { name: "Network checks are unavailable in this build" })).toBeTruthy();
    expect(screen.getByText(/not signed, so macOS hides the list of network services/)).toBeTruthy();
    expect(screen.getByText(/^Affects \d+ checks$/)).toBeTruthy();
    expect(screen.queryByText(/Remote Login \(SSH\) is off/)).toBeNull();
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

  it("shows the honest unavailable state for every user, and the Overview AI card is available_idle for an unlicensed user with the AI connected", () => {
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE, ai: "device_not_eligible" }) }, createElement(Overview)));
    expect(screen.getByText(AI_UNAVAILABLE_COPY.device_not_eligible)).toBeTruthy();
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("device_not_eligible");
    cleanup();
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE, ai: "available" }) }, createElement(Overview)));
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("available_idle");
    expect(screen.getByRole("button", { name: "Suggest an order" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Paste your licence key")).toBeNull();
    cleanup();
    render(createElement(AppContext.Provider, { value: readyContext({ state: DEV_MACHINE, license: NONE, aiEnabled: false }) }, createElement(Overview)));
    expect(document.querySelector(".ai-card")).toBeNull();
  });

  it("renders the seven provider states on the order card, with Connect my AI and Choose another opening the connect screen for the Overview", () => {
    const lines = providerLines("chatgpt");
    const connect = fakeConnectController();
    const show = (ai: AiAvailability, until: string | null = null) =>
      render(createElement(StatefulProvider, { value: readyContext({ state: DEV_MACHINE, license: NONE, provider: "chatgpt", ai, until }), connect }, createElement(Overview)));
    show("not_connected");
    expect(document.querySelector("[data-ai-state='not_connected']")).not.toBeNull();
    expect(screen.getByText(lines.notConnected)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.connect }));
    expect(connect.open).toHaveBeenCalledWith({ name: "overview" });
    cleanup();
    show("connecting");
    expect(screen.getByRole("status").textContent).toBe(lines.connecting);
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.cancel }));
    expect(connect.cancel).toHaveBeenCalled();
    cleanup();
    show("needs_sign_in");
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.signInAgain }));
    expect(connect.signInAgain).toHaveBeenCalledWith({ name: "overview" });
    cleanup();
    const sixPm = new Date(2026, 9, 16, 18, 0, 0).toISOString();
    show("limit_reached", sixPm);
    expect(document.querySelector(".ai-card-head p")?.textContent).toBe("Your ChatGPT allowance is used up for now. It comes back at 18:00.");
    expect(document.querySelectorAll(".ai-card button").length).toBe(0);
    cleanup();
    show("plan_not_eligible");
    expect(screen.getByText(lines.planNotEligible)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: AI_ACTIONS.chooseAnother }));
    expect(connect.open).toHaveBeenLastCalledWith({ name: "overview" });
    cleanup();
    show("provider_unavailable");
    expect(screen.getByText(lines.providerUnavailable)).toBeTruthy();
    expect(screen.getByRole("button", { name: AI_ACTIONS.tryAgain })).toBeTruthy();
    cleanup();
    show("not_offered");
    expect(screen.getByText(lines.notOffered)).toBeTruthy();
    expect(screen.getByRole("button", { name: AI_ACTIONS.chooseAnother })).toBeTruthy();
  });

  it("signs a ChatGPT order with the ChatGPT badge", () => {
    const priority = { order: ["TL-MAC-002", "TL-MAC-001"] as RuleId[], reasons: [], startWith: ["TL-MAC-002"] as RuleId[] };
    const ready = readyContext({ state: DEV_MACHINE, license: VALID, provider: "chatgpt", explain: { kind: "ready", byRule: {}, order: ["TL-MAC-002", "TL-MAC-001"], priority } });
    render(createElement(AppContext.Provider, { value: ready }, createElement(Overview)));
    expect(screen.getByText(AI_BADGES.chatgpt)).toBeTruthy();
    expect(screen.queryByText(AI_BADGE)).toBeNull();
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

  it("lists the next fixes by their problem headline, each row opening its finding with no inline action", () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE });
    render(createElement(AppContext.Provider, { value }, createElement(Overview)));
    expect(screen.getByRole("link", { name: "Your disk is not encrypted" })).toBeTruthy();
    expect(screen.queryByText("Your disk is encrypted")).toBeNull();
    const card = document.querySelector('.finding-card[data-rule-id="TL-MAC-001"]') as HTMLElement;
    expect(card.querySelector(".finding-card-action")).toBeNull();
    expect(card.querySelectorAll("a, button").length).toBe(1);
    expect(card.querySelector(".finding-card-cost")?.textContent).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Your disk is not encrypted" }));
    expect(value.router.navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-001" });
    expect(value.scan.previewFix).not.toHaveBeenCalled();
  });

  it("opens the confirmation sheet for the fix the scan state holds", () => {
    const plan: FixPlan = fakePlan({ ruleId: "TL-MAC-002", recheck: ["firewall"] });
    const fixing: FixingState = { kind: "single", plan, phase: "confirm", step: 0, of: 1, error: null, result: null };
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
      expect(card.textContent).toMatch(/Affects (\d+ checks|1 check: )/);
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
    const main = document.querySelector(".screen") as HTMLElement;
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

  it("heads the page with the problem, the badge and one category line, and says the status only when it is not a failure", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-002");
    expect(screen.getByRole("heading", { level: 1, name: "The firewall is off" })).toBeTruthy();
    expect(screen.getByText("Network · CIS 2.2.1")).toBeTruthy();
    expect(screen.queryByText(/What we check/)).toBeNull();
    expect(document.querySelector(".detail-meta .status")).toBeNull();
    expect(document.querySelectorAll(".button-primary").length).toBe(1);
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE }), "TL-MAC-028");
    expect(document.querySelector(".detail-meta .status")?.textContent).toBe("Couldn't check");
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

  it("explains every rule when the AI is connected, free or paid, and never when it is not connected", () => {
    const value = readyContext({ state: DEV_MACHINE, license: NONE });
    const failing = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" }).findings.filter((f) => f.status === "fail");
    const free = failing.find((f) => value.gate.freeFixes.includes(f.ruleId))?.ruleId as RuleId;
    const paid = failing.find((f) => !value.gate.freeFixes.includes(f.ruleId))?.ruleId as RuleId;
    expect(free).toBeTruthy();
    expect(paid).toBeTruthy();
    renderDetail(value, free);
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("available_idle");
    cleanup();
    renderDetail(value, paid);
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("available_idle");
    // The fix stays behind its lock; the explanation does not.
    expect(screen.getByText("This fix is part of the full version")).toBeTruthy();
    expect(screen.getByText("The three most valuable fixes are free. A licence unlocks every fix, Check again and the menu bar watch.")).toBeTruthy();
    expect(document.querySelectorAll("input[placeholder='Paste your licence key']").length).toBe(1);
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE, provider: "claude_plan", ai: "not_connected" }), paid);
    expect(document.querySelector(".ai-card")?.getAttribute("data-ai-state")).toBe("not_connected");
    expect(screen.getByRole("button", { name: AI_ACTIONS.connect })).toBeTruthy();
  });

  it("hides the AI card when AI is off and shows the model-not-ready state without a lock", () => {
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE, aiEnabled: false }), "TL-MAC-002");
    expect(document.querySelector(".ai-card")).toBeNull();
    cleanup();
    renderDetail(readyContext({ state: DEV_MACHINE, license: NONE, ai: "model_not_ready" }), "TL-MAC-002");
    expect(screen.getByText(AI_UNAVAILABLE_COPY.model_not_ready)).toBeTruthy();
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
    const confirm: SingleFixingState = { kind: "single", plan, phase: "confirm", step: 0, of: 1, error: null, result: null };
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
  it("lets any user with the AI on ask for an AI order from the Findings screen", () => {
    const value = readyContext({ state: DEV_MACHINE, license: VALID });
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.getByRole("heading", { name: "Suggested order" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suggest an order" }));
    expect(value.scan.prioritise).toHaveBeenCalledTimes(1);
  });

  it("shows the aside for an unlicensed user too, and shows a prioritise failure inline", () => {
    const unlicensed = readyContext({ state: DEV_MACHINE, license: NONE });
    render(createElement(AppContext.Provider, { value: unlicensed }, createElement(Findings)));
    expect(screen.getByRole("heading", { name: "Suggested order" })).toBeTruthy();
    expect(document.querySelector(".findings-layout.with-aside")).not.toBeNull();
    expect(screen.queryByPlaceholderText("Paste your licence key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Suggest an order" }));
    expect(unlicensed.scan.prioritise).toHaveBeenCalledTimes(1);
    cleanup();
    const off = readyContext({ state: DEV_MACHINE, license: NONE, aiEnabled: false });
    render(createElement(AppContext.Provider, { value: off }, createElement(Findings)));
    expect(screen.queryByRole("heading", { name: "Suggested order" })).toBeNull();
    expect(document.querySelector(".findings-layout.with-aside")).toBeNull();
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

describe("Settings", () => {
  const caps: Capabilities = { fullDiskAccess: false, automation: "not_determined", bundled: true };
  function settingsProps(overrides: Partial<SettingsProps> = {}): SettingsProps {
    return { aiAvailability: "available", onAiAction: vi.fn(), capabilities: caps, onPermission: vi.fn(), onBuy: vi.fn(), onChangeAi: vi.fn(), onDisconnect: vi.fn(async () => true), ...overrides };
  }
  function dev(provider: ExplainerProvider, explainer: Partial<AppSettings["explainer"]> = {}): AppSettings {
    return { ...DEFAULT_SETTINGS, onboarded: true, developer: { ...DEFAULT_SETTINGS.developer, enabled: true }, explainer: { ...DEFAULT_SETTINGS.explainer, provider, ...explainer } };
  }
  function mount(props: Partial<SettingsProps> = {}, input: { settings?: AppSettings; license?: LicenseState; adapters?: Adapters; stateful?: boolean } = {}) {
    const adapters = input.adapters ?? fakeAdapters();
    const license = input.license ?? NONE;
    const value = fakeContextValue({ adapters, license, gate: stubGate(license.status === "valid"), catalog, settings: input.settings, scanState: { kind: "idle", report: null, last: null } });
    const full = settingsProps(props);
    render(createElement(input.stateful ? StatefulProvider : AppContext.Provider, { value }, createElement(Settings, full)));
    return { value, adapters, props: full };
  }

  it("keeps the seven sections in the design order once licensed", () => {
    mount({}, { license: VALID });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([WATCH_SETTINGS.title, "Check-up", YOUR_AI.title, "Permissions", "Licence", "Developer mode", "About"]);
  });

  it("unlicensed Settings has no Watch section and no switch labelled WATCH_SETTINGS.enabled", () => {
    mount();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Check-up", YOUR_AI.title, "Permissions", "Licence", "Developer mode", "About"]);
    expect(document.getElementById("watch-heading")).toBeNull();
    expect(screen.queryByRole("switch", { name: WATCH_SETTINGS.enabled })).toBeNull();
    expect(screen.getByText(FREE_LINE)).toBeTruthy();
    expect(screen.getByText(PAID_LINE)).toBeTruthy();
    expect(screen.getByPlaceholderText("Paste your licence key")).toBeTruthy();
  });

  it("the licence lines read under 1.6 syllables per word and carry no banned word", () => {
    const banned = /\b(finding|findings|severity|CIS|rule|rules|policy|configuration|SSH|launchd|plist|daemon|sudo|Terminal|TCC|stealth|sysadminctl|command|points)\b/i;
    for (const line of [FREE_LINE, PAID_LINE]) {
      expect(syllablesPerWord(line), line).toBeLessThanOrEqual(1.6);
      expect(line).not.toMatch(banned);
    }
    expect(PAID_LINE).toBe("A licence adds every fix, Check again and the menu bar watch, which starts when you paste a key.");
  });

  it("pasting the demo key mounts the Watch section first", async () => {
    const adapters = fakeAdapters();
    adapters.license.install = vi.fn(async (key: string): Promise<LicenseState> => (key === "TL1.GOOD" ? VALID : { status: "invalid", reason: "signature" }));
    mount({}, { adapters, stateful: true });
    expect(document.getElementById("watch-heading")).toBeNull();
    const input = screen.getByLabelText("Licence key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "TL1.GOOD" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(document.getElementById("watch-heading")).not.toBeNull());
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe(WATCH_SETTINGS.title);
    expect(screen.getByRole("switch", { name: WATCH_SETTINGS.enabled })).toBeTruthy();
    expect(screen.queryByLabelText("Licence key")).toBeNull();
  });

  it("drives the Your AI pill from the availability prop, the Apple button from onAiAction, and the switch from the settings", () => {
    const { value, props } = mount({ aiAvailability: "apple_intelligence_not_enabled" });
    const toggle = screen.getByRole("switch", { name: YOUR_AI.switch }) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    const row = document.querySelector(".your-ai-row") as HTMLElement;
    expect(row.querySelector(".your-ai-name")?.textContent).toBe(PROVIDER_NAMES.apple);
    expect(row.querySelector(".your-ai-pill")?.textContent).toBe("Needs Apple Intelligence");
    fireEvent.click(screen.getByRole("button", { name: "Open Apple Intelligence settings" }));
    expect(props.onAiAction).toHaveBeenCalledWith("apple_intelligence_not_enabled");
    fireEvent.click(screen.getByRole("button", { name: YOUR_AI.change }));
    expect(props.onChangeAi).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: YOUR_AI.disconnect })).toBeNull();
    const sentence = screen.getByText(YOUR_AI.sentence);
    expect(sentence.tagName).toBe("P");
    expect(sentence.closest(".settings-group")).toBe(row.closest(".settings-group"));
    fireEvent.click(toggle);
    expect(value.updateSettings).toHaveBeenCalledWith({ explainer: { ...value.settings.explainer, aiEnabled: false } });
    cleanup();
    mount({ aiAvailability: "available" });
    const ready = document.querySelector(".your-ai-pill") as HTMLElement;
    expect(ready.textContent).toBe("Ready");
    expect(ready.classList.contains("pill-accent")).toBe(true);
    cleanup();
    mount({ aiAvailability: "device_not_eligible" });
    expect(screen.getByText("This Mac can't run it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Try again|Open Apple/ })).toBeNull();
    cleanup();
    mount({ aiAvailability: null });
    expect(document.querySelector(".your-ai-pill")?.textContent).toBe("Checking");
    cleanup();
    mount({ aiAvailability: "off" }, { settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, aiEnabled: false } } });
    expect(screen.queryByText("Off")).toBeNull();
    expect(document.querySelector(".your-ai-pill")).toBeNull();
    expect((screen.getByRole("switch", { name: YOUR_AI.switch }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByRole("button", { name: YOUR_AI.change })).toBeTruthy();
    expect(screen.queryByRole("button", { name: YOUR_AI.disconnect })).toBeNull();
    cleanup();
    // The Connect screen would have no row: Change is hidden and the honest line stays.
    mount({ aiAvailability: "device_not_eligible", canChangeAi: false });
    expect(screen.queryByRole("button", { name: YOUR_AI.change })).toBeNull();
    expect(screen.getByText("This Mac can't run it")).toBeTruthy();
    cleanup();
    // With the switch off nothing probes, so a ChatGPT or Claude sign-in can still be removed from this Mac.
    for (const provider of ["chatgpt", "claude_plan"] as const) {
      const onDisconnect = vi.fn(async () => true);
      mount({ aiAvailability: "off", onDisconnect }, { settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, aiEnabled: false, provider } } });
      expect(document.querySelector(".your-ai-pill")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: YOUR_AI.disconnect }));
      expect(onDisconnect).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("words the pill for every ChatGPT state and offers Disconnect only while a sign-in exists", async () => {
    const chatgpt: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" } };
    const states: AiAvailability[] = ["available", "not_connected", "connecting", "needs_sign_in", "limit_reached", "plan_not_eligible", "provider_unavailable", "not_offered"];
    const disconnectable = ["available", "needs_sign_in", "limit_reached", "plan_not_eligible", "provider_unavailable"];
    for (const state of states) {
      mount({ aiAvailability: state }, { settings: chatgpt });
      const pill = document.querySelector(".your-ai-pill") as HTMLElement;
      expect(pill.textContent, state).toBe(aiPillWord("chatgpt", state));
      expect(pill.classList.contains("pill-accent"), state).toBe(state === "available");
      expect(document.querySelector(".your-ai-name")?.textContent).toBe("ChatGPT");
      expect(screen.queryByRole("button", { name: YOUR_AI.disconnect }) !== null, state).toBe(disconnectable.includes(state));
      expect(screen.queryByRole("button", { name: /Try again|Open Apple/ }), state).toBeNull();
      cleanup();
    }
    expect(aiPillWord("chatgpt", "available")).toBe("Connected");
    expect(aiPillWord("claude_plan", "not_offered")).toBe("Not available yet");
    let release: () => void = () => undefined;
    const onDisconnect = vi.fn(() => new Promise<boolean>((resolve) => (release = () => resolve(true))));
    mount({ aiAvailability: "available", onDisconnect }, { settings: chatgpt });
    const disconnect = screen.getByRole("button", { name: YOUR_AI.disconnect }) as HTMLButtonElement;
    disconnect.focus();
    fireEvent.click(disconnect);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(disconnect.getAttribute("aria-busy")).toBe("true"));
    expect(disconnect.disabled).toBe(false);
    release();
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".your-ai-row .setting-text")));
  });

  it("a refused Disconnect keeps the pill and the button and says the sign-in could not be cleared", async () => {
    const claude: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude_plan" } };
    const onDisconnect = vi.fn(async () => false);
    mount({ aiAvailability: "available", onDisconnect }, { settings: claude });
    expect(screen.queryByRole("alert")).toBeNull();
    const disconnect = screen.getByRole("button", { name: YOUR_AI.disconnect }) as HTMLButtonElement;
    disconnect.focus();
    fireEvent.click(disconnect);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(YOUR_AI.disconnectFailed));
    expect((document.querySelector(".your-ai-pill") as HTMLElement).textContent).toBe("Connected");
    expect(disconnect.disabled).toBe(false);
    expect(document.activeElement).toBe(disconnect);
    // A second try that is accepted clears the line.
    onDisconnect.mockResolvedValueOnce(true);
    fireEvent.click(disconnect);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(onDisconnect).toHaveBeenCalledTimes(2);
  });

  it("collapses the profile to one line and expands the controls on Edit", () => {
    // v0.3 moved "About you" under Developer mode.
    const { value } = mount({}, { settings: { ...DEFAULT_SETTINGS, onboarded: true, developer: { ...DEFAULT_SETTINGS.developer, enabled: true }, profile: { role: "freelancer", technical: "medium", handlesClientData: true, laptopLeavesHome: true } } });
    expect(screen.getByText("Freelancer, somewhat technical, client data, laptop leaves home")).toBeTruthy();
    expect(screen.queryByLabelText("As a freelancer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("As a freelancer") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Very"));
    expect(value.updateSettings).toHaveBeenCalledWith({ profile: { ...value.settings.profile, technical: "high" } });
  });

  it("shows a small status line per permission and an Open or Allow button driven by props", () => {
    const { props } = mount();
    const status = screen.getByText("Not granted");
    expect(status.tagName).toBe("SMALL");
    expect(status.getAttribute("data-status")).toBe("not_granted");
    expect(document.querySelector(".setting-rows .pill")).toBeNull();
    expect(screen.getByText("Not asked yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Full Disk Access" }));
    expect(props.onPermission).toHaveBeenCalledWith("full_disk_access", "not_granted");
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(props.onPermission).toHaveBeenCalledWith("automation", "not_determined");
    cleanup();
    mount({ capabilities: { fullDiskAccess: true, automation: "denied", bundled: true } });
    expect(screen.getByText("Granted")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Full Disk Access" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Automation settings" })).toBeTruthy();
    cleanup();
    mount({ capabilities: { fullDiskAccess: null, automation: null, bundled: true } });
    expect(screen.getAllByText("Could not tell").length).toBe(2);
    cleanup();
    mount({ capabilities: null });
    expect(screen.getAllByText("Checking").length).toBe(2);
  });

  it("adds the dev-build hint under Full Disk Access only when the binary is not bundled and the permission is missing", () => {
    mount({ capabilities: { fullDiskAccess: false, automation: "granted", bundled: false } });
    const hint = screen.getByText(DEV_BUILD_FDA_COPY);
    expect(hint.tagName).toBe("SMALL");
    expect(hint.closest(".setting-row")?.textContent).toContain("Full Disk Access");
    expect(screen.getByRole("button", { name: "Open Full Disk Access" })).toBeTruthy();
    cleanup();
    mount({ capabilities: { fullDiskAccess: true, automation: "denied", bundled: false } });
    expect(screen.queryByText(DEV_BUILD_FDA_COPY)).toBeNull();
    cleanup();
    mount({ capabilities: { fullDiskAccess: false, automation: "denied", bundled: true } });
    expect(screen.queryByText(DEV_BUILD_FDA_COPY)).toBeNull();
  });

  it("offers the inline licence field with the free line, then the licensed line with Remove", async () => {
    const adapters = fakeAdapters();
    adapters.license.install = vi.fn(async (key: string): Promise<LicenseState> => (key === "TL1.GOOD" ? VALID : { status: "invalid", reason: "signature" }));
    const { props } = mount({}, { adapters, stateful: true });
    expect(screen.getByText(FREE_LINE)).toBeTruthy();
    expect(screen.getByText(PAID_LINE).tagName).toBe("SMALL");
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
    // The Watch section's interval radios come first on the page; only the provider group is read here.
    const radios = screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).name === "provider").map((r) => (r.closest("label") as HTMLElement).textContent?.trim());
    expect(radios).toEqual(["On this Mac", "ChatGPT", "Claude", "Claude API key", "Local Ollama"]);
    expect((screen.getByLabelText("Local Ollama") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Model name")).toBeTruthy();
    expect(screen.getByText(claudeCodeLine(null))).toBeTruthy();
    expect(screen.getByText(chatgptClientLine(null))).toBeTruthy();
    expect(screen.queryByLabelText("Anthropic API key")).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Show Terminal commands next to fixes" }));
    expect(on.value.updateSettings).toHaveBeenCalledWith({ developer: { ...on.value.settings.developer, showCommands: false } });
    fireEvent.click(screen.getByRole("switch", { name: "Developer mode" }));
    expect(on.value.updateSettings).toHaveBeenCalledWith({ developer: { ...on.value.settings.developer, enabled: false }, explainer: { ...on.value.settings.explainer, provider: "apple" } });
    cleanup();
    // A connected subscription survives leaving Developer mode; only the API-key and Ollama providers reset.
    const sub = mount({}, { settings: dev("chatgpt") });
    fireEvent.click(screen.getByRole("switch", { name: "Developer mode" }));
    expect(sub.value.updateSettings).toHaveBeenCalledWith({ developer: { ...sub.value.settings.developer, enabled: false }, explainer: sub.value.settings.explainer });
  });

  it("keeps the Your AI rows clean under axe for a connected and a signed-out subscription", async () => {
    const chatgpt: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" } };
    for (const state of ["available", "needs_sign_in", "not_connected"] as const) {
      mount({ aiAvailability: state }, { settings: chatgpt });
      const result = await axe.run(document.querySelector(".your-ai-row") as Element, AXE_RULES);
      expect(result.violations.map((v) => v.id), state).toEqual([]);
      cleanup();
    }
  });

  it("shows the ChatGPT model id field with an empty value allowed, and the read-only Claude Code and client id lines", () => {
    const info = { offered: true, version: "2.1.287", path: "/Users/me/.local/share/claude/versions/2.1.287", signed: true, identity: "Developer ID Application: Anthropic PBC (Q6L2SF6YDW)", source: "existing" as const };
    const { value } = mount({ providerInfo: { claudeCode: info, chatgptClientId: "oaiapp_abc123" } }, { settings: dev("chatgpt") });
    const input = screen.getByLabelText("Model id") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByText("Empty uses your account's default")).toBeTruthy();
    expect(screen.queryByLabelText("Anthropic API key")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /API key/ })).toBeNull();
    fireEvent.change(input, { target: { value: "gpt-5" } });
    expect(value.updateSettings).toHaveBeenCalledWith({ explainer: { ...value.settings.explainer, chatgptModel: "gpt-5" } });
    const lines = Array.from(document.querySelectorAll(".dev-ai-info")).map((n) => n.textContent);
    expect(lines).toEqual(["Claude Code: 2.1.287, Developer ID Application: Anthropic PBC (Q6L2SF6YDW), /Users/me/.local/share/claude/versions/2.1.287", "ChatGPT client id: oaiapp_abc123"]);
    cleanup();
    mount({}, { settings: dev("chatgpt", { chatgptModel: "GPT 5" }) });
    expect((screen.getByLabelText("Model id") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("chatgpt-model-error")?.textContent).toContain("lowercase letters, digits, dots and dashes");
    cleanup();
    mount({ providerInfo: { claudeCode: { ...info, version: null, path: null, signed: false, identity: null, source: "none" }, chatgptClientId: null } }, { settings: dev("claude_plan") });
    expect(Array.from(document.querySelectorAll(".dev-ai-info")).map((n) => n.textContent)).toEqual(["Claude Code: not fetched", "ChatGPT client id: None"]);
    expect(screen.queryByLabelText("Model id")).toBeNull();
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
    expect(screen.getByText("taloslabs.si")).toBeTruthy();
    expect(screen.getByText(__BUILD_DATE__)).toBeTruthy();
    expect(screen.getByText(/01HXYZ/)).toBeTruthy();
    expect(screen.getByText(/cafebabe/)).toBeTruthy();
    expect(screen.getByText(PRIVACY_SENTENCE)).toBeTruthy();
    expect(screen.queryByText(PRIVACY_SENTENCE_REMOTE)).toBeNull();
    expect(screen.queryByText(/ChatGPT/)).toBeNull();
    cleanup();
    for (const provider of ["chatgpt", "claude_plan", "claude", "ollama"] as const) {
      mount({}, { license, settings: { ...DEFAULT_SETTINGS, onboarded: true, explainer: { ...DEFAULT_SETTINGS.explainer, provider } } });
      expect(screen.getByText(PRIVACY_SENTENCE_REMOTE), provider).toBeTruthy();
      expect(screen.queryByText(PRIVACY_SENTENCE), provider).toBeNull();
      cleanup();
    }
  });
});

/** A guided memory with the given rules left alone on 10 October. */
function leftAlone(...ruleIds: RuleId[]): GuidedMemory {
  const accepted: Record<string, string> = {};
  for (const id of ruleIds) accepted[id] = "2026-10-10T09:00:00.000Z";
  return { ...EMPTY_GUIDED_MEMORY, accepted };
}

describe("formatDate", () => {
  it("reads the day and the month in British English, and returns an invalid value as is", () => {
    expect(formatDate("2026-10-17T09:00:00.000Z")).toBe("17 October");
    expect(formatDate("2026-01-02T23:30:00.000Z")).toMatch(/^[23] January$/);
    expect(formatDate("not a date")).toBe("not a date");
  });
});

describe("FindingDetail and the checks the person chose to leave", () => {
  function renderDetail(value: ReturnType<typeof readyContext>, ruleId: RuleId) {
    return render(createElement(AppContext.Provider, { value }, createElement(FindingDetail, { ruleId })));
  }
  const detail = (license: LicenseState, memory: GuidedMemory = EMPTY_GUIDED_MEMORY) => ({ ...readyContext({ state: DEV_MACHINE, license }), guidedMemory: memory });

  it("offers Leave it alone under the fix card and under the lock, and the press calls acceptRule once", () => {
    const free = detail(NONE);
    renderDetail(free, "TL-MAC-001");
    expect(screen.getByRole("heading", { name: "How to fix it" })).toBeTruthy();
    const offer = document.querySelector(".accept-offer") as HTMLElement;
    expect(offer.querySelector("p")?.textContent).toBe(ACCEPT.offer);
    expect(document.querySelector(".accept-strip")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: ACCEPT.link }));
    expect(free.acceptRule).toHaveBeenCalledTimes(1);
    expect(free.acceptRule).toHaveBeenCalledWith("TL-MAC-001");
    expect(free.unacceptRule).not.toHaveBeenCalled();
    cleanup();
    const locked = detail(NONE);
    renderDetail(locked, "TL-MAC-022");
    expect(document.querySelector(".lock")).not.toBeNull();
    expect(screen.getByRole("button", { name: ACCEPT.link })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/accept/i);
  });

  it("offers nothing for a review, an unknown or a passing check", () => {
    const value = detail(VALID);
    const review = value.scan.scan.kind === "ready" ? value.scan.scan.report.findings.find((f) => f.status === "review")?.ruleId : undefined;
    expect(review).toBeTruthy();
    for (const id of [review as RuleId, "TL-MAC-028" as RuleId, "TL-MAC-004" as RuleId]) {
      renderDetail(value, id);
      expect(document.querySelector(".accept-offer"), id).toBeNull();
      expect(document.querySelector(".accept-strip"), id).toBeNull();
      cleanup();
    }
  });

  it("shows the strip with the date, the pill and Ask me again in place of the fix card once left alone, keeping the AI and recheck cards", () => {
    const value = detail(NONE, leftAlone("TL-MAC-001"));
    renderDetail(value, "TL-MAC-001");
    const strip = document.querySelector(".accept-strip") as HTMLElement;
    expect(strip.getAttribute("role")).toBe("status");
    expect(strip.textContent).toContain("You chose to leave this on 10 October. It still counts against the score.");
    expect(screen.queryByRole("heading", { name: "How to fix it" })).toBeNull();
    expect(document.querySelector(".lock")).toBeNull();
    expect(document.querySelector(".accept-offer")).toBeNull();
    expect(document.querySelector(".detail-meta .status-left-alone")?.textContent).toBe(ACCEPT.pill);
    expect(document.querySelector(".ai-card")).not.toBeNull();
    expect(document.querySelector(".recheck")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Why it matters" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ACCEPT.undo }));
    expect(value.unacceptRule).toHaveBeenCalledWith("TL-MAC-001");
    expect(value.acceptRule).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/accept/i);
  });

  it("shows neither the strip nor the pill for a rule in the map whose check passes", () => {
    renderDetail(detail(NONE, leftAlone("TL-MAC-004")), "TL-MAC-004");
    expect(document.querySelector(".accept-strip")).toBeNull();
    expect(document.querySelector(".status-left-alone")).toBeNull();
    expect(screen.getByText("Passed")).toBeTruthy();
  });

  /** The memory as real state, so the strip and the offer swap under the press as they do in App. */
  function AcceptHost({ value, ruleId }: { value: ReturnType<typeof detail>; ruleId: RuleId }) {
    const [memory, setMemory] = useState(value.guidedMemory);
    const live = {
      ...value,
      guidedMemory: memory,
      acceptRule: (id: RuleId) => setMemory((m) => ({ ...m, accepted: { ...m.accepted, [id]: "2026-10-10T09:00:00.000Z" } })),
      unacceptRule: (id: RuleId) => setMemory((m) => ({ ...m, accepted: Object.fromEntries(Object.entries(m.accepted).filter(([k]) => k !== id)) })),
    };
    return createElement(AppContext.Provider, { value: live }, createElement(FindingDetail, { ruleId }));
  }

  it("moves focus to the strip after Leave it alone and to the offer after Ask me again, and moves nothing on open", () => {
    render(createElement(AcceptHost, { value: detail(NONE), ruleId: "TL-MAC-001" }));
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole("button", { name: ACCEPT.link }));
    expect(document.activeElement).toBe(document.querySelector(".accept-strip"));
    fireEvent.click(screen.getByRole("button", { name: ACCEPT.undo }));
    expect(document.activeElement).toBe(document.querySelector(".accept-offer"));
    expect(screen.getByRole("heading", { name: "How to fix it" })).toBeTruthy();
    cleanup();
    render(createElement(AcceptHost, { value: detail(NONE, leftAlone("TL-MAC-001")), ruleId: "TL-MAC-001" }));
    expect(document.activeElement).toBe(document.body);
  });
});

describe("Findings and the checks the person chose to leave", () => {
  it("keeps the accepted rule inside Needs fixing, last, with the pill, the count unchanged and no AI rank even from a cached order", () => {
    const explain: ExplainState = { kind: "ready", byRule: {}, order: ["TL-MAC-001", "TL-MAC-002", "TL-MAC-003"], priority: { order: ["TL-MAC-001", "TL-MAC-002", "TL-MAC-003"], reasons: [], startWith: ["TL-MAC-001"] } };
    const value = withAi(fakeContextValue({ adapters: fakeAdapters(), license: VALID, gate: stubGate(true), catalog, scanState: readyState(explain), guidedMemory: leftAlone("TL-MAC-001") }), "available");
    render(createElement(AppContext.Provider, { value }, createElement(Findings)));
    expect(screen.getByRole("heading", { name: "Needs fixing, 2 items" })).toBeTruthy();
    const group = document.getElementById("group-needs-fixing")?.closest("section") as HTMLElement;
    const cards = Array.from(group.querySelectorAll(".finding-card"));
    expect(cards.map((c) => c.getAttribute("data-rule-id"))).toEqual(["TL-MAC-002", "TL-MAC-001"]);
    const last = cards[1] as HTMLElement;
    expect(last.querySelector(".badge-left-alone")?.textContent).toBe(ACCEPT.pill);
    expect(last.querySelector(".badge-rank")).toBeNull();
    expect(last.querySelector(".finding-card-points")?.textContent).toBe("+20 points when fixed");
    expect((cards[0] as HTMLElement).querySelector(".badge-rank")?.textContent).toContain("AI #1");
    expect((cards[0] as HTMLElement).querySelector(".badge-left-alone")).toBeNull();
    // The suggested order beside the groups has no row for it either.
    expect(document.querySelector('.suggested-order [data-rule-id="TL-MAC-001"]')).toBeNull();
    expect(document.querySelector('.suggested-order [data-rule-id="TL-MAC-002"]')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/accept/i);
  });
});

describe("Overview and the checks the person chose to leave", () => {
  const overview = (memory: GuidedMemory, explain?: ExplainState) => ({ ...readyContext({ state: DEV_MACHINE, license: NONE, ...(explain === undefined ? {} : { explain }) }), guidedMemory: memory });
  const tile = () => (screen.getByText("Needs fixing").previousElementSibling as HTMLElement).textContent;

  it("adds the one line at one and two, none at zero, and keeps the Needs fixing tile counting every failing rule", () => {
    render(createElement(AppContext.Provider, { value: overview(EMPTY_GUIDED_MEMORY) }, createElement(Overview)));
    expect(document.querySelector(".score-chosen")).toBeNull();
    const count = tile();
    cleanup();
    render(createElement(AppContext.Provider, { value: overview(leftAlone("TL-MAC-001")) }, createElement(Overview)));
    expect(document.querySelector(".score-chosen")?.textContent).toBe("1 thing you chose to leave still counts.");
    expect(tile()).toBe(count);
    cleanup();
    render(createElement(AppContext.Provider, { value: overview(leftAlone("TL-MAC-001", "TL-MAC-002")) }, createElement(Overview)));
    expect(document.querySelector(".score-chosen")?.textContent).toBe("2 things you chose to leave still count.");
    expect(tile()).toBe(count);
    cleanup();
    // A rule in the map whose check passes does not count.
    render(createElement(AppContext.Provider, { value: overview(leftAlone("TL-MAC-004")) }, createElement(Overview)));
    expect(document.querySelector(".score-chosen")).toBeNull();
  });

  it("hides the accepted row from Next three fixes and keeps the heading", () => {
    render(createElement(AppContext.Provider, { value: overview(leftAlone("TL-MAC-001")) }, createElement(Overview)));
    const section = document.querySelector("section[aria-labelledby='next-fixes']") as HTMLElement;
    expect(section).not.toBeNull();
    expect(section.querySelector('[data-rule-id="TL-MAC-001"]')).toBeNull();
    expect(section.querySelectorAll(".finding-card").length).toBe(2);
  });

  it("renders no row for the accepted rule under any heading of a suggested order that still names it", () => {
    const priority = { order: ["TL-MAC-001", "TL-MAC-002", "TL-MAC-010"] as RuleId[], reasons: [{ ruleId: "TL-MAC-001" as RuleId, reason: "Encrypt first." }], startWith: ["TL-MAC-001"] as RuleId[] };
    const explain: ExplainState = { kind: "ready", byRule: {}, order: priority.order, priority };
    render(createElement(AppContext.Provider, { value: overview(leftAlone("TL-MAC-001"), explain) }, createElement(Overview)));
    const body = document.querySelector(".suggested-order") as HTMLElement;
    expect(body).not.toBeNull();
    expect(body.querySelector('[data-rule-id="TL-MAC-001"]')).toBeNull();
    expect(body.querySelector('[data-rule-id="TL-MAC-002"]')).not.toBeNull();
    expect(screen.queryByText("Encrypt first.")).toBeNull();
    // The only "start with" rule was the accepted one, so that heading goes and the numbering starts at 1 under Then.
    expect(screen.queryByText("Start with")).toBeNull();
    expect(screen.getByText("Then")).toBeTruthy();
    expect(body.querySelector("ol li .finding-mark")?.textContent).toBe("1");
  });
});

describe("Settings and the checks the person chose to leave", () => {
  const caps: Capabilities = { fullDiskAccess: false, automation: "not_determined", bundled: true };
  const props: SettingsProps = { aiAvailability: "available", onAiAction: vi.fn(), capabilities: caps, onPermission: vi.fn(), onBuy: vi.fn() };
  const report = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });
  function mountWith(memory: GuidedMemory, extra: Partial<SettingsProps> = {}, settings?: AppSettings) {
    const value = fakeContextValue({ adapters: fakeAdapters(), license: NONE, gate: stubGate(false), scanState: { kind: "idle", report: null, last: report }, guidedMemory: memory, ...(settings === undefined ? {} : { settings }) });
    render(createElement(AppContext.Provider, { value }, createElement(Settings, { ...props, ...extra })));
    return value;
  }

  it("renders the read-only section only while a left-alone check still fails; its rows open the finding and carry no undo", () => {
    mountWith(EMPTY_GUIDED_MEMORY);
    expect(document.getElementById("chosen-heading")).toBeNull();
    cleanup();
    mountWith(leftAlone("TL-MAC-004"));
    expect(document.getElementById("chosen-heading")).toBeNull();
    cleanup();
    const value = mountWith(leftAlone("TL-MAC-001"));
    expect(document.getElementById("chosen-heading")?.textContent).toBe(END.chosen);
    expect(screen.getByText(ACCEPT.settingsSentence)).toBeTruthy();
    const list = document.querySelector(".settings-accepted-list") as HTMLElement;
    expect(list.querySelectorAll("li").length).toBe(1);
    expect(list.textContent).toContain("Your disk is not encrypted");
    // Each row's button is named by its headline, as the end screen's rows are, so two rows never read alike.
    expect(screen.getByRole("button", { name: `Your disk is not encrypted ${END.details}` })).toBe(list.querySelector("button"));
    expect(screen.queryByRole("button", { name: ACCEPT.undo })).toBeNull();
    expect(screen.queryByRole("switch", { name: /leave/i })).toBeNull();
    fireEvent.click(list.querySelector("button") as HTMLButtonElement);
    expect(value.router.navigate).toHaveBeenCalledWith({ name: "finding", ruleId: "TL-MAC-001" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf(END.chosen)).toBe(headings.indexOf("Check-up") + 1);
    expect(document.body.textContent).not.toMatch(/accept/i);
  });

  it("the Developer guided block prints the accepted date for an id in plan.accepted", () => {
    localStorage.setItem("talos.guided", JSON.stringify(leftAlone("TL-MAC-001")));
    const plan = { reportId: "r", freeFixes: [], steps: [{ id: "show:TL-MAC-010", kind: "show", ruleId: "TL-MAC-010", pane: "software_update", watch: ["updates"], watchEvery: 3000, restart: false, question: null }], leftAlone: [], worthALook: [], technical: [], later: [], locked: [], accepted: ["TL-MAC-001"], unreadable: 0 } as const;
    const controller: GuidedController = {
      phase: { kind: "end", plan, fixed: [] },
      progress: { done: 1, of: 1 },
      start: vi.fn(),
      carryOn: vi.fn(),
      primary: vi.fn(),
      later: vi.fn(),
      next: vi.fn(),
      answer: vi.fn(),
      toggleList: vi.fn(),
      enterLicence: vi.fn(async () => undefined),
      doNext: vi.fn(),
      goToPaywall: vi.fn(),
      chat: INERT_CHAT_BRIDGE,
      keepAsking: vi.fn(),
      accept: vi.fn(),
    };
    const settings: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, developer: { ...DEFAULT_SETTINGS.developer, enabled: true } };
    mountWith(leftAlone("TL-MAC-001"), { guided: { controller, onResetMemory: vi.fn(), onSkipCooldown: vi.fn() } }, settings);
    const block = screen.getByTestId("guided-dev");
    expect(block.textContent).toContain("TL-MAC-001 · accepted 2026-10-10T09:00:00.000Z");
    expect(block.textContent).toContain("show:TL-MAC-010 · show");
    localStorage.removeItem("talos.guided");
  });
});
