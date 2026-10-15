import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_028 } from "../../src/rules/macos/tl-mac-028";
import type { BrowserReport } from "../../src/domain/system-state";
import { describeRule, patchSection, runRule } from "../helpers";

const broad: BrowserReport = {
  browser: "brave",
  extensions: {
    status: "ok",
    data: [
      { id: "abc", name: "Everything Reader", version: "1.0", permissions: ["tabs"], broadHostAccess: true },
      { id: "def", name: "Quiet", version: "1.0", permissions: [], broadHostAccess: false },
    ],
  },
};

const blocked: BrowserReport = {
  browser: "chrome",
  extensions: { status: "unavailable", reason: "needs_full_disk_access", detail: "read_dir" },
};

describeRule(TL_MAC_028, [
  {
    name: "pass when no extension has broad access",
    state: HARDENED,
    status: "pass",
    keys: ["browserCount", "broadAccessCount"],
    kinds: ["number", "number"],
  },
  {
    name: "unknown with needs_full_disk_access when Chrome is blocked and nothing was found",
    state: DEV_MACHINE,
    status: "unknown",
    reason: "needs_full_disk_access",
    keys: ["browserCount", "broadAccessCount", "uncheckedBrowser"],
    kinds: ["number", "number", "enum"],
  },
  {
    name: "fail when an extension reads every site",
    state: patchSection(HARDENED, "browsers", { installed: [broad] }),
    status: "fail",
    keys: ["browserCount", "broadAccessCount", "browser", "extensionName"],
    kinds: ["number", "number", "enum", "text"],
  },
  {
    name: "a hit wins over an unavailable browser",
    state: patchSection(HARDENED, "browsers", { installed: [blocked, broad] }),
    status: "fail",
    keys: ["browserCount", "broadAccessCount", "browser", "extensionName", "uncheckedBrowser"],
  },
  {
    name: "forwards a different nested reason too",
    state: patchSection(HARDENED, "browsers", {
      installed: [{ browser: "firefox", extensions: { status: "unavailable", reason: "parse_error", detail: "parser: extensions.json" } }],
    }),
    status: "unknown",
    reason: "parse_error",
  },
  { name: "not applicable when no browser is installed", state: FRESH_INSTALL, status: "not_applicable", keys: [] },
]);

describe("TL-MAC-028 fix text", () => {
  it("summarises the extension fix alone and leaves Full Disk Access to the permission card", () => {
    expect(TL_MAC_028.fix.summary).toBe("Limit each extension to the sites it needs, or set it to run only when you click it.");
    expect(TL_MAC_028.fix.settingsPath).toBeNull();
    expect(TL_MAC_028.fix.settingsPane).toBeNull();
  });

  it("names Firefox alongside the Chrome family in the Full Disk Access step", () => {
    const step = TL_MAC_028.fix.steps.find((s) => s.includes("Full Disk Access"));
    expect(step).toBeDefined();
    expect(step).toContain("Firefox");
    expect(step).toContain("Chrome, Brave, Edge, Arc");
    expect(step).toMatch(/listed as not checked/);
  });

  it("labels the count as what was found, so 0 next to an unchecked browser does not read as clean", () => {
    const result = runRule(TL_MAC_028, DEV_MACHINE);
    const count = result.evidence.find((entry) => entry.key === "broadAccessCount");
    expect(count?.label).toBe("Extensions found with access to every site");
    expect(result.evidence.some((entry) => entry.key === "uncheckedBrowser")).toBe(true);
  });
});
