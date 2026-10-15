import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_022: Rule = {
  id: "TL-MAC-022",
  title: "Shared folders are not open to guests",
  severity: "high",
  category: "sharing",
  cis: "2.13.2, 2.3.3.2",
  os: MACOS_ONLY,
  requires: ["fileSharing"],
  evidenceKeys: ["enabled", "shareCount", "guestShareCount", "sharePath"],
  evidenceVocabulary: {},
  explanation:
    "File Sharing is on and at least one shared folder lets guests in without a password. Anyone on the same network can open that folder and read, and often change, what is inside. On a cafe or hotel network that means strangers.",
  fix: {
    summary: "Stop guests connecting to shared folders, or turn File Sharing off.",
    settingsPath: ["System Settings", "Users & Groups", "Guest User"],
    settingsPane: "users_groups",
    commands: [],
    steps: [
      "Open System Settings, then Users & Groups, click the (i) next to Guest User and switch off Allow guest users to connect to shared folders.",
      "Or open General, then Sharing, click the (i) next to File Sharing, select the folder and set Everyone to No Access.",
      "Or, if you do not share files from this Mac, switch File Sharing off altogether.",
    ],
    verify: "Run the check-up again; the guest share count is 0 or File Sharing is off.",
    effort: "two_minutes",
    sideEffects: "workflow",
  },
  evaluate(state) {
    const data = section(state, "fileSharing");
    const guestShares = data.shares.filter((share) => share.guestAccess);
    const evidence: Evidence[] = [
      ev.bool("enabled", "File Sharing on", data.enabled),
      ev.number("shareCount", "Shared folders", data.shares.length, "count"),
      ev.number("guestShareCount", "Folders open to guests", guestShares.length, "count"),
    ];
    for (const share of guestShares) {
      evidence.push(ev.path("sharePath", "Guest folder", share.path));
    }
    const ok = !data.enabled || guestShares.length === 0;
    return ok ? pass(evidence) : fail(evidence);
  },
};
