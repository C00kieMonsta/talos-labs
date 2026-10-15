import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileReportStore } from "./file-report-store";
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

describe("FileReportStore", () => {
  it("saves the report and serves it from memory afterwards", async () => {
    const store = new FileReportStore();
    invokeMock.mockResolvedValueOnce(undefined);
    await store.saveLast(TEST_REPORT);
    expect(invokeMock).toHaveBeenCalledWith("report_save_last", { report: TEST_REPORT });
    expect(await store.current()).toBe(TEST_REPORT);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("loads the last report from disk and ignores malformed data", async () => {
    const store = new FileReportStore();
    invokeMock.mockResolvedValueOnce(TEST_REPORT);
    expect(await store.loadLast()).toEqual(TEST_REPORT);
    invokeMock.mockResolvedValueOnce({ hello: "world" });
    expect(await store.loadLast()).toBeNull();
    invokeMock.mockResolvedValueOnce(null);
    expect(await store.loadLast()).toBeNull();
  });

  it("current() falls back to disk and swallows a read failure", async () => {
    const store = new FileReportStore();
    invokeMock.mockRejectedValueOnce("no such file");
    expect(await store.current()).toBeNull();
  });
});

describe("openSettingsPane", () => {
  it("passes the pane name only", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await openSettingsPane("full_disk_access");
    expect(invokeMock).toHaveBeenCalledWith("open_settings_pane", { pane: "full_disk_access" });
  });
});
