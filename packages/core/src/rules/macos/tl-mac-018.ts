import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

/** Apple services that bind all interfaces by design. Matched by full name only. */
export const APPLE_LISTENER_ALLOW_LIST: readonly string[] = [
  "ControlCenter",
  "rapportd",
  "sharingd",
  "AirPlayXPCHelper",
];

/** Ports judged by rules 019 to 022. */
export const PORTS_OWNED_BY_OTHER_RULES: readonly number[] = [22, 445, 5900, 3283];

export const TL_MAC_018: Rule = {
  id: "TL-MAC-018",
  title: "No program is listening for connections from the network",
  severity: "medium",
  category: "network",
  cis: null,
  os: MACOS_ONLY,
  requires: ["listeners"],
  evidenceKeys: ["exposedCount", "port", "processName"],
  evidenceVocabulary: {},
  explanation:
    "A program on your Mac is accepting connections from other computers on the network, not only from the Mac itself. On home Wi-Fi that may be fine, but on a cafe or hotel network anyone nearby can try to talk to it. Development servers, databases and media tools often do this without you noticing.",
  fix: {
    summary: "Quit or reconfigure the listening program, or block all incoming connections in the firewall.",
    settingsPath: ["System Settings", "Network", "Firewall", "Options"],
    settingsPane: "firewall",
    commands: [],
    steps: [
      "Find the program named in the evidence. If you do not use it, quit it or uninstall it.",
      "If you need it, set it to listen on 127.0.0.1 only; most tools have a setting or flag for this.",
      "For a stronger default, open System Settings, then Network, then Firewall, click Options and switch on Block all incoming connections.",
    ],
    verify: "Run the check-up again; the port no longer appears in the evidence.",
    effort: "ten_minutes",
    sideEffects: "workflow",
  },
  evaluate(state) {
    const data = section(state, "listeners");
    const exposed = data.entries.filter(
      (entry) =>
        entry.bind !== "loopback" &&
        !PORTS_OWNED_BY_OTHER_RULES.includes(entry.port) &&
        !(entry.processName !== null && APPLE_LISTENER_ALLOW_LIST.includes(entry.processName)),
    );
    const evidence: Evidence[] = [ev.number("exposedCount", "Programs reachable from the network", exposed.length, "count")];
    for (const entry of exposed) {
      evidence.push(ev.number("port", "Open port", entry.port, "port"));
      if (entry.processName !== null) {
        evidence.push(ev.text("processName", "Program", entry.processName));
      }
    }
    return exposed.length === 0 ? pass(evidence) : fail(evidence);
  },
};
