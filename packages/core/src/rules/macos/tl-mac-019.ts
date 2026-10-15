import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import type { ServiceState } from "../../domain/system-state";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

/** Shared by 019 and 020: off when the service is not loaded and nothing listens. */
export function remoteServiceOutcome(service: ServiceState) {
  const evidence: Evidence[] = [];
  if (service.serviceLoaded !== null) {
    evidence.push(ev.bool("serviceLoaded", "Service switched on", service.serviceLoaded));
  }
  if (service.listeningPort !== null) {
    evidence.push(ev.number("listeningPort", "Listening on port", service.listeningPort, "port"));
  }
  const off = service.serviceLoaded !== true && service.listeningPort === null;
  return off ? pass(evidence) : fail(evidence);
}

export const TL_MAC_019: Rule = {
  id: "TL-MAC-019",
  title: "Remote Login (SSH) is off",
  failTitle: "Remote Login (SSH) is on",
  severity: "high",
  category: "remote_access",
  cis: "2.3.3.4",
  os: MACOS_ONLY,
  requires: ["remoteAccess"],
  evidenceKeys: ["serviceLoaded", "listeningPort"],
  evidenceVocabulary: {},
  explanation:
    "Remote Login lets someone log in to this Mac over the network using SSH, a text-based remote control. If it is on and your password or key is weak or leaked, an attacker on the same network can get a full session on your Mac. Most people never need it on.",
  fix: {
    summary: "Turn off Remote Login in the Sharing settings.",
    settingsPath: ["System Settings", "General", "Sharing", "Remote Login"],
    settingsPane: "sharing",
    commands: [],
    steps: ["Open System Settings, then General, then Sharing.", "Switch off Remote Login."],
    verify: "Sharing shows Remote Login off, and the check-up no longer reports port 22.",
    effort: "two_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    return remoteServiceOutcome(section(state, "remoteAccess").ssh);
  },
};
