import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import type { SystemState } from "../../domain/system-state";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

/** Apple services that bind all interfaces by design. Matched by full name only. */
export const APPLE_LISTENER_ALLOW_LIST: readonly string[] = [
  "ControlCenter",
  "rapportd",
  "sharingd",
  "AirPlayXPCHelper",
];

/** Ports judged by rules 019 to 021. */
export const PORTS_OWNED_BY_OTHER_RULES: readonly number[] = [22, 5900, 3283];

/** Rule 022 owns 445 only while a share is open to Everyone; otherwise this rule reports it. */
export const SMB_PORT = 445;

function smbOwnedByRule022(state: SystemState): boolean {
  const fileSharing = state.sections.fileSharing;
  return fileSharing.status === "ok" && fileSharing.data.shares.some((share) => share.guestAccess);
}

export const TL_MAC_018: Rule = {
  id: "TL-MAC-018",
  title: "No program is listening for connections from the network",
  failTitle: "A program is listening for connections from the network",
  severity: "medium",
  category: "network",
  cis: null,
  os: MACOS_ONLY,
  requires: ["listeners"],
  evidenceKeys: ["exposedCount", "namesIncomplete", "port", "processName"],
  evidenceVocabulary: {},
  explanation:
    "A program on your Mac is accepting connections from other computers on the network, not only from the Mac itself. On home Wi-Fi that may be fine, but on a cafe or hotel network anyone nearby can try to talk to it. Development servers, databases and media tools often do this without you noticing.",
  fix: {
    summary: "Quit or reconfigure the listening program, or block all incoming connections in the firewall.",
    settingsPath: ["System Settings", "Network", "Firewall", "Options"],
    settingsPane: "firewall",
    commands: [
      {
        program: "lsof",
        args: ["-nP", "-iTCP", "-sTCP:LISTEN"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Find the program named in the evidence. If no name is shown, the port number is the clue: check any development servers, databases or media tools you have running. If you do not use it, quit it or uninstall it.",
      "Port 445 is File Sharing, shown as launchd or smbd. If you do not share files from this Mac, switch File Sharing off under General, then Sharing.",
      "If you need it, set it to listen on 127.0.0.1 only; most tools have a setting or flag for this.",
      "For a stronger default, open System Settings, then Network, then Firewall, click Options and switch on Block all incoming connections.",
    ],
    verify: "Run the check-up again; the port no longer appears in the evidence.",
    effort: "ten_minutes",
    sideEffects: "workflow",
    apply: {
      kind: "deep_link",
      pane: "firewall",
      watch: ["listeners"],
      watchEvery: 3,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "listeners");
    const ownedPorts = smbOwnedByRule022(state) ? [...PORTS_OWNED_BY_OTHER_RULES, SMB_PORT] : PORTS_OWNED_BY_OTHER_RULES;
    const exposed = data.entries.filter(
      (entry) =>
        entry.bind !== "loopback" &&
        !ownedPorts.includes(entry.port) &&
        !(entry.processName !== null && APPLE_LISTENER_ALLOW_LIST.includes(entry.processName)),
    );
    const evidence: Evidence[] = [ev.number("exposedCount", "Programs reachable from the network", exposed.length, "count")];
    if (!data.processNamesComplete && exposed.some((entry) => entry.processName === null)) {
      evidence.push(ev.bool("namesIncomplete", "Some program names could not be read", true));
    }
    for (const entry of exposed) {
      evidence.push(ev.number("port", "Open port", entry.port, "port"));
      if (entry.processName !== null) {
        evidence.push(ev.text("processName", "Program", entry.processName));
      }
    }
    return exposed.length === 0 ? pass(evidence) : fail(evidence);
  },
};
