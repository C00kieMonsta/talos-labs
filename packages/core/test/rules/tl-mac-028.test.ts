import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { FRESH_INSTALL } from "../../src/fixtures/fresh-install";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_028 } from "../../src/rules/macos/tl-mac-028";
import type { BrowserReport } from "../../src/domain/system-state";
import { describeRule, patchSection } from "../helpers";

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
