import type { Rule } from "../../domain/rule";
import { ev, MACOS_ONLY, pass, section } from "../helpers";
import { remoteServiceOutcome } from "./tl-mac-019";

export const TL_MAC_020: Rule = {
  id: "TL-MAC-020",
  title: "Screen Sharing is off",
  failTitle: "Screen Sharing is on",
  severity: "high",
  category: "remote_access",
  cis: "2.3.3.1",
  os: MACOS_ONLY,
  requires: ["remoteAccess"],
  evidenceKeys: ["serviceLoaded", "listeningPort", "coveredByRemoteManagement"],
  evidenceVocabulary: {},
  explanation:
    "Screen Sharing lets another computer see and control your screen over the network. It is handy for a moment of help, but left on it is a way for anyone with your password to use the Mac as if they were sitting at it. Turn it on only when you need it.",
  guided: {
    headline: "Others can see your screen over the network",
    why: "Screen Sharing lets someone watch and control your Mac.",
    verb: "Turn it off",
    done: "Done. Screen Sharing is off.",
    where: null,
  },
  fix: {
    summary: "Turn off Screen Sharing in the Sharing settings.",
    settingsPath: ["System Settings", "General", "Sharing", "Screen Sharing"],
    settingsPane: "sharing",
    commands: [],
    steps: [
      "Open System Settings, then General, then Sharing.",
      "If Remote Management is on, switch that off first; it includes Screen Sharing, and the Screen Sharing switch stays greyed out until it is off.",
      "Switch off Screen Sharing.",
    ],
    verify: "Sharing shows Screen Sharing off, and the check-up no longer reports port 5900.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "in_app",
      choice: "none",
      passphrase: false,
      needsPassword: true,
      recheck: ["remoteAccess", "listeners"],
      confirmTitle: "Turn Screen Sharing off?",
      confirmVerb: "Turn off",
      confirmNote: null,
      reversible: "You can switch it on again in System Settings > General > Sharing.",
    },
  },
  evaluate(state) {
    const data = section(state, "remoteAccess");
    const outcome = remoteServiceOutcome(data.screenSharing);
    // Remote Management serves port 5900 itself; rule 021 carries that finding.
    if (data.remoteManagement?.serviceLoaded === true) {
      return pass([...outcome.evidence, ev.bool("coveredByRemoteManagement", "Included in Remote Management", true)]);
    }
    return outcome;
  },
};
