import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { HARDENED } from "../../src/fixtures/hardened";
import { TL_MAC_018 } from "../../src/rules/macos/tl-mac-018";
import { describeRule, patchSection } from "../helpers";

const base = HARDENED.sections.listeners.status === "ok" ? HARDENED.sections.listeners.data.entries : [];

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
    name: "ports owned by rules 019 to 022 are suppressed",
    state: patchSection(HARDENED, "listeners", {
      entries: [22, 445, 5900, 3283].map((port) => ({ protocol: "tcp" as const, port, bind: "all" as const, processName: "launchd", pid: 1 })),
    }),
    status: "pass",
    keys: ["exposedCount"],
  },
]);
