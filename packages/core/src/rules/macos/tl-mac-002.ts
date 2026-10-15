import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_002: Rule = {
  id: "TL-MAC-002",
  title: "The firewall is on",
  failTitle: "The firewall is off",
  severity: "high",
  category: "network",
  cis: "2.2.1",
  os: MACOS_ONLY,
  requires: ["firewall"],
  evidenceKeys: ["enabled"],
  evidenceVocabulary: {},
  explanation:
    "The firewall decides which programs may accept connections from other computers on the network. With it off, any program that opens a port is reachable from the cafe Wi-Fi or hotel network you are on. Turning it on costs nothing and most apps never notice.",
  fix: {
    summary: "Turn the firewall on in System Settings.",
    settingsPath: ["System Settings", "Network", "Firewall"],
    settingsPane: "firewall",
    commands: [
      {
        program: "/usr/libexec/ApplicationFirewall/socketfilterfw",
        args: ["--setglobalstate", "on"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: ["Open System Settings, then Network, then Firewall.", "Switch Firewall on."],
    verify: "Network > Firewall shows the switch on.",
    effort: "two_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    const data = section(state, "firewall");
    const evidence = [ev.bool("enabled", "Firewall on", data.enabled)];
    return data.enabled ? pass(evidence) : fail(evidence);
  },
};
