import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_016: Rule = {
  id: "TL-MAC-016",
  title: "Nobody is logged in automatically",
  failTitle: "Someone is logged in automatically",
  severity: "high",
  category: "access_control",
  cis: "2.13.3",
  os: MACOS_ONLY,
  requires: ["accounts"],
  evidenceKeys: ["autoLoginEnabled"],
  evidenceVocabulary: {},
  explanation:
    "Automatic login means the Mac goes straight to your desktop when it starts, with no password. Anyone who turns it on gets your files, email and saved passwords. It also undoes much of FileVault's benefit, because the disk is unlocked without a password being typed.",
  fix: {
    summary: "Set Automatically log in as to Off.",
    settingsPath: ["System Settings", "Users & Groups"],
    settingsPane: "users_groups",
    commands: [
      {
        program: "sysadminctl",
        args: ["-autologin", "off"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Open System Settings, then Users & Groups.",
      "Set Automatically log in as to Off.",
    ],
    verify: "The Mac asks for a password at the login screen after a restart.",
    effort: "two_minutes",
    sideEffects: "reauth",
    apply: {
      kind: "in_app",
      choice: "none",
      passphrase: false,
      needsPassword: true,
      recheck: ["accounts"],
      confirmTitle: "Turn automatic login off?",
      confirmVerb: "Turn off",
      confirmNote: null,
      reversible: "You can choose an account again in System Settings > Users & Groups.",
    },
  },
  evaluate(state) {
    const data = section(state, "accounts");
    const evidence = [ev.bool("autoLoginEnabled", "Automatic login", data.autoLoginEnabled)];
    return data.autoLoginEnabled ? fail(evidence) : pass(evidence);
  },
};
