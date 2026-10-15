import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section, TRI_VOCABULARY } from "../helpers";

export const TL_MAC_015: Rule = {
  id: "TL-MAC-015",
  title: "The Guest account is off",
  failTitle: "The Guest account is on",
  severity: "medium",
  category: "access_control",
  cis: "2.13.1",
  os: MACOS_ONLY,
  requires: ["accounts"],
  evidenceKeys: ["guestEnabled"],
  evidenceVocabulary: { guestEnabled: TRI_VOCABULARY },
  explanation:
    "The Guest account lets anyone use your Mac without a password. On a laptop that is a way in for anyone who picks it up. Unless you have a specific need for it, keep it off.",
  fix: {
    summary: "Turn off guest login in Users & Groups.",
    settingsPath: ["System Settings", "Users & Groups", "Guest User"],
    settingsPane: "users_groups",
    commands: [
      {
        program: "sysadminctl",
        args: ["-guestAccount", "off"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Open System Settings, then Users & Groups, and click the (i) next to Guest User.",
      "Switch off Allow guests to log in to this computer.",
    ],
    verify: "Guest User shows as Off in Users & Groups.",
    effort: "two_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    const data = section(state, "accounts");
    const evidence = [ev.tri("guestEnabled", "Guest login", data.guestEnabled)];
    return data.guestEnabled === true ? fail(evidence) : pass(evidence);
  },
};
