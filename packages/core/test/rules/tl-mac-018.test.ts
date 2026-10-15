import { describe, expect, it } from "vitest";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_018 } from "../../src/rules/macos/tl-mac-018";
import type { Listener } from "../../src/domain/system-state";
import { describeRule, patchSection, withUnavailable } from "../helpers";

const base = HARDENED.sections.listeners.status === "ok" ? HARDENED.sections.listeners.data.entries : [];
const smb: Listener = { protocol: "tcp", port: 445, bind: "all", processName: "launchd", pid: 1 };
const guestShare = patchSection(HARDENED, "fileSharing", { enabled: true, shares: [{ path: "/Users/sam/Public", guestAccess: true }] });
const passwordShare = patchSection(HARDENED, "fileSharing", { enabled: true, shares: [{ path: "/Users/sam/Public", guestAccess: false }] });

describeRule(TL_MAC_018, [
  { name: "pass with only allow-listed Apple services", state: HARDENED, status: "pass", keys: ["exposedCount"], kinds: ["number"] },
  { name: "pass on the dev machine (loopback, owned 445, allow-list)", state: DEV_MACHINE, status: "pass", keys: ["exposedCount"] },
  {
    name: "fail when a program listens on all interfaces",
    state: patchSection(HARDENED, "listeners", {
      entries: [...base, { protocol: "tcp", port: 8080, bind: "all", processName: "node", pid: 900 }],
    }),
    status: "fail",
    keys: ["exposedCount", "port", "processName"],
    kinds: ["number", "number", "text"],
  },
  {
    name: "fail on a link-local bind too",
    state: patchSection(HARDENED, "listeners", {
      entries: [{ protocol: "tcp", port: 8081, bind: "link_local", processName: null, pid: null }],
    }),
    status: "fail",
    keys: ["exposedCount", "port"],
    kinds: ["number", "number"],
  },
  {
    name: "the allow-list matches full names only",
    state: patchSection(HARDENED, "listeners", {
      entries: [{ protocol: "tcp", port: 5001, bind: "all", processName: "ControlCenterX", pid: 1 }],
    }),
    status: "fail",
    keys: ["exposedCount", "port", "processName"],
  },
  {
    name: "launchd is never allow-listed",
    state: patchSection(HARDENED, "listeners", {
      entries: [{ protocol: "tcp", port: 631, bind: "all", processName: "launchd", pid: 1 }],
    }),
    status: "fail",
  },
  {
    name: "ports owned by rules 019 to 021 are suppressed",
    state: patchSection(HARDENED, "listeners", {
      entries: [22, 5900, 3283].map((port) => ({ protocol: "tcp" as const, port, bind: "all" as const, processName: "launchd", pid: 1 })),
    }),
    status: "pass",
    keys: ["exposedCount"],
  },
  {
    name: "445 is suppressed while a share is open to Everyone (rule 022 owns it)",
    state: patchSection(guestShare, "listeners", { entries: [smb] }),
    status: "pass",
    keys: ["exposedCount"],
  },
  {
    name: "445 with password-only shares is reported",
    state: patchSection(passwordShare, "listeners", { entries: [smb] }),
    status: "fail",
    keys: ["exposedCount", "port", "processName"],
  },
  {
    name: "445 is reported when the fileSharing section is unavailable",
    state: patchSection(withUnavailable(HARDENED, "fileSharing", "tool_missing"), "listeners", { entries: [smb] }),
    status: "fail",
    keys: ["exposedCount", "port", "processName"],
  },
  {
    name: "a nameless exposed entry is flagged as incomplete and still fails",
    state: patchSection(HARDENED, "listeners", {
      entries: [
        { protocol: "tcp", port: 5000, bind: "all", processName: null, pid: null },
        { protocol: "tcp", port: 7000, bind: "all", processName: null, pid: null },
      ],
      processNamesComplete: false,
    }),
    status: "fail",
    keys: ["exposedCount", "namesIncomplete", "port", "port"],
    kinds: ["number", "bool", "number", "number"],
  },
  {
    name: "incomplete names on loopback entries alone add nothing",
    state: patchSection(HARDENED, "listeners", {
      entries: [...base, { protocol: "tcp", port: 9000, bind: "loopback", processName: null, pid: null }],
      processNamesComplete: false,
    }),
    status: "pass",
    keys: ["exposedCount"],
  },
]);

describe("TL-MAC-018 fix", () => {
  it("carries the listener lookup as a Developer-mode command and keeps it out of the steps", () => {
    expect(TL_MAC_018.fix.commands).toEqual([
      { program: "lsof", args: ["-nP", "-iTCP", "-sTCP:LISTEN"], needsAdmin: true, interactive: false, appliesTo: null },
    ]);
    expect(TL_MAC_018.fix.settingsPath).not.toBeNull();
    for (const step of TL_MAC_018.fix.steps) {
      expect(step).not.toMatch(/\b(lsof|command|commands|terminal)\b/i);
    }
  });
});
