import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notApplicable, pass, section, unknown } from "../helpers";

export const TL_MAC_021: Rule = {
  id: "TL-MAC-021",
  title: "Remote Management is off",
  failTitle: "Remote Management is on",
  severity: "high",
  category: "remote_access",
  cis: "2.3.3.5",
  os: MACOS_ONLY,
  requires: ["remoteAccess"],
  evidenceKeys: ["serviceLoaded", "listeningPort"],
  evidenceVocabulary: {},
  explanation:
    "Remote Management is Apple's tool for administrators to control Macs across a network. On a personal Mac it should be off, because it gives whoever can connect full control. It is sometimes left on by an old job or an IT tool.",
  fix: {
    summary: "Turn off Remote Management in the Sharing settings.",
    settingsPath: ["System Settings", "General", "Sharing", "Remote Management"],
    settingsPane: "sharing",
    commands: [
      {
        program: "/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart",
        args: ["-deactivate", "-configure", "-access", "-off"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: ["Open System Settings, then General, then Sharing.", "Switch off Remote Management."],
    verify: "Sharing shows Remote Management off.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "in_app",
      choice: "none",
      passphrase: false,
      needsPassword: true,
      recheck: ["remoteAccess", "listeners"],
      confirmTitle: "Turn Remote Management off?",
      confirmVerb: "Turn off",
      confirmNote: null,
      reversible: "You can switch it on again in System Settings > General > Sharing.",
    },
  },
  evaluate(state) {
    const service = section(state, "remoteAccess").remoteManagement;
    if (service === null) {
      return notApplicable();
    }
    const evidence: Evidence[] = [];
    if (service.listeningPort !== null) {
      evidence.push(ev.number("listeningPort", "Listening on port", service.listeningPort, "port"));
    }
    if (service.serviceLoaded === null) {
      return unknown("indeterminate", evidence);
    }
    evidence.unshift(ev.bool("serviceLoaded", "Service switched on", service.serviceLoaded));
    return service.serviceLoaded ? fail(evidence) : pass(evidence);
  },
};
