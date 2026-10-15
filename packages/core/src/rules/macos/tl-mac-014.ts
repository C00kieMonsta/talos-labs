import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_014: Rule = {
  id: "TL-MAC-014",
  title: "Your everyday account is not an administrator",
  failTitle: "Your everyday account is an administrator",
  severity: "low",
  category: "access_control",
  cis: null,
  os: MACOS_ONLY,
  requires: ["accounts"],
  evidenceKeys: ["currentUserIsAdmin", "humanAdminCount"],
  evidenceVocabulary: {},
  explanation:
    "An administrator account can install anything and change any setting. If malware or a bad download runs while you are logged in as an administrator, it gets those powers too. Using a standard account day to day means you are asked for an administrator password before anything important changes, which is a useful moment to pause.",
  fix: {
    summary: "Create a separate administrator account and make your daily account a standard user.",
    settingsPath: ["System Settings", "Users & Groups"],
    settingsPane: "users_groups",
    commands: [],
    steps: [
      "Open System Settings, then Users & Groups, and click Add Account. Choose Administrator and give it a strong password.",
      "Log out and log in as the new administrator account.",
      "Back in Users & Groups, click the (i) next to your daily account and untick Allow this user to administer this computer.",
      "Log back in to your daily account. You will now be asked for the administrator name and password when something needs it.",
    ],
    verify: "Users & Groups lists your daily account as Standard.",
    effort: "half_hour",
    sideEffects: "workflow",
  },
  evaluate(state) {
    const data = section(state, "accounts");
    const evidence = [
      ev.bool("currentUserIsAdmin", "Current account is an administrator", data.currentUserIsAdmin),
      ev.number("humanAdminCount", "Administrator accounts", data.humanAdminCount, "count"),
    ];
    return data.currentUserIsAdmin ? fail(evidence) : pass(evidence);
  },
};
