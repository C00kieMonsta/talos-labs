import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_022: Rule = {
  id: "TL-MAC-022",
  title: "No shared folder is open to Everyone",
  failTitle: "A shared folder is open to Everyone",
  severity: "high",
  category: "sharing",
  cis: "2.13.2",
  os: MACOS_ONLY,
  requires: ["fileSharing"],
  evidenceKeys: ["enabled", "shareCount", "guestShareCount", "sharePath"],
  evidenceVocabulary: {},
  explanation:
    "File Sharing is on and at least one shared folder gives Everyone access, so a guest with no password can open it from the network and read, and often change, what is inside. On a cafe or hotel network that means strangers.",
  fix: {
    summary: "Set Everyone to No Access on the shared folder, or turn File Sharing off.",
    settingsPath: ["System Settings", "General", "Sharing", "File Sharing"],
    settingsPane: "sharing",
    commands: [],
    steps: [
      "Open System Settings, then General, then Sharing, click the (i) next to File Sharing, select the folder shown in the evidence and set Everyone to No Access.",
      "Or, if you do not share files from this Mac, switch File Sharing off altogether.",
      "Switching off Allow guest users to connect to shared folders under Users & Groups also keeps guests out, but this check does not read that switch, so the folder stays listed until its Everyone setting changes.",
    ],
    verify: "Run the check-up again; the count of folders open to Everyone is 0, or File Sharing is off.",
    effort: "two_minutes",
    sideEffects: "workflow",
  },
  evaluate(state) {
    const data = section(state, "fileSharing");
    const guestShares = data.shares.filter((share) => share.guestAccess);
    const evidence: Evidence[] = [
      ev.bool("enabled", "File Sharing on", data.enabled),
      ev.number("shareCount", "Shared folders", data.shares.length, "count"),
      ev.number("guestShareCount", "Folders open to Everyone", guestShares.length, "count"),
    ];
    for (const share of guestShares) {
      evidence.push(ev.path("sharePath", "Folder open to Everyone", share.path));
    }
    const ok = !data.enabled || guestShares.length === 0;
    return ok ? pass(evidence) : fail(evidence);
  },
};
