import type { Rule } from "../../domain/rule";
import { MACOS_ONLY, notApplicable, section } from "../helpers";
import { remoteServiceOutcome } from "./tl-mac-019";

export const TL_MAC_033: Rule = {
  id: "TL-MAC-033",
  title: "Remote Apple Events is off",
  failTitle: "Remote Apple Events is on",
  severity: "medium",
  category: "remote_access",
  cis: "2.3.3.6",
  os: MACOS_ONLY,
  requires: ["remoteAccess"],
  evidenceKeys: ["serviceLoaded", "listeningPort"],
  evidenceVocabulary: {},
  explanation:
    "Remote Apple Events lets another Mac send this one the messages AppleScript uses to drive apps, over the network. With it on, anyone who can log in to this Mac from another computer can tell its apps what to do. It is off by default: macOS ships the service disabled, and when the Sharing list does not mention it at all, this check reads that as off.",
  guided: {
    headline: "Other Macs can send events to this one",
    why: "Another computer can tell your Mac what to do over the network.",
    verb: "Turn it off",
    done: "Done. Other Macs can no longer send events to this one.",
    where: null,
  },
  fix: {
    summary: "Turn off Remote Application Scripting in the Sharing settings.",
    settingsPath: ["System Settings", "General", "Sharing", "Remote Application Scripting"],
    settingsPane: "sharing",
    commands: [],
    steps: ["Open System Settings, then General, then Sharing, and switch Remote Application Scripting off."],
    verify: "Sharing shows Remote Application Scripting off, and the check-up no longer reports port 3031.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "in_app",
      choice: "none",
      passphrase: false,
      needsPassword: true,
      recheck: ["remoteAccess", "listeners"],
      confirmTitle: "Turn Remote Apple Events off?",
      confirmVerb: "Turn off",
      confirmNote: null,
      reversible: "You can turn it back on in System Settings > General > Sharing > Remote Application Scripting.",
    },
  },
  evaluate(state) {
    const service = section(state, "remoteAccess").remoteAppleEvents;
    if (service === null) {
      return notApplicable();
    }
    return remoteServiceOutcome(service);
  },
};
