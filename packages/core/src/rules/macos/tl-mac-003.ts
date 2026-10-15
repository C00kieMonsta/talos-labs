import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notApplicable, pass, section } from "../helpers";

export const TL_MAC_003: Rule = {
  id: "TL-MAC-003",
  title: "Your Mac stays quiet to network probes",
  failTitle: "Your Mac answers network probes",
  severity: "low",
  category: "network",
  cis: "2.2.2",
  os: MACOS_ONLY,
  requires: ["firewall"],
  evidenceKeys: ["stealthMode"],
  evidenceVocabulary: {},
  explanation:
    "Stealth mode makes your Mac ignore the probes that attackers and automated scanners send to find computers on a network. With it off, your Mac answers those probes and confirms it is there. It is a small change that makes you a less obvious target on shared Wi-Fi.",
  fix: {
    summary: "Enable stealth mode in the firewall options.",
    settingsPath: ["System Settings", "Network", "Firewall", "Options"],
    settingsPane: "firewall",
    commands: [
      {
        program: "/usr/libexec/ApplicationFirewall/socketfilterfw",
        args: ["--setstealthmode", "on"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Open System Settings, then Network, then Firewall, and click Options.",
      "Switch on Enable stealth mode and click OK.",
    ],
    verify: "Network > Firewall > Options shows Enable stealth mode switched on.",
    effort: "two_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    const data = section(state, "firewall");
    if (data.stealthMode === null) {
      return notApplicable();
    }
    const evidence = [ev.bool("stealthMode", "Stealth mode on", data.stealthMode)];
    return data.stealthMode ? pass(evidence) : fail(evidence);
  },
};
