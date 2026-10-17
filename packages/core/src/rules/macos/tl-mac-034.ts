import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section, TRI_VOCABULARY } from "../helpers";

export const TL_MAC_034: Rule = {
  id: "TL-MAC-034",
  title: "Internet Sharing is off",
  failTitle: "Internet Sharing is on",
  severity: "medium",
  category: "sharing",
  cis: "2.3.3.7",
  os: MACOS_ONLY,
  requires: ["remoteAccess"],
  evidenceKeys: ["internetSharing"],
  evidenceVocabulary: { internetSharing: TRI_VOCABULARY },
  explanation:
    "Internet Sharing turns this Mac into a router: it hands its internet connection to other devices over Wi-Fi, Ethernet or Bluetooth. Every device that joins sits on a network this Mac runs, one hop from its files and services, and the Wi-Fi it creates is visible to anyone nearby. Few people need it on at home, and it is easy to leave on by mistake.",
  guided: {
    headline: "Your Mac is passing its internet on to others",
    why: "Anyone on your network could use that to get in.",
    verb: "Show me where",
    done: "Done. Your Mac keeps its internet to itself now.",
    where: "Switch \"Internet Sharing\" off.",
  },
  fix: {
    summary: "Turn off Internet Sharing in the Sharing settings.",
    settingsPath: ["System Settings", "General", "Sharing", "Internet Sharing"],
    settingsPane: "sharing",
    commands: [],
    steps: ["Open System Settings, then General, then Sharing, and switch Internet Sharing off."],
    verify: "Sharing shows Internet Sharing off. Run the check-up again; this check passes.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "deep_link",
      pane: "sharing",
      watch: ["remoteAccess"],
      watchEvery: 3,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "remoteAccess");
    const evidence = [ev.tri("internetSharing", "Internet Sharing on", data.internetSharing)];
    return data.internetSharing === true ? fail(evidence) : pass(evidence);
  },
};
