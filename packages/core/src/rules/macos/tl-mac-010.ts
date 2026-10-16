import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section, unknown } from "../helpers";

export const TL_MAC_010: Rule = {
  id: "TL-MAC-010",
  title: "No update is waiting",
  failTitle: "An update is waiting to be installed",
  severity: "high",
  category: "updates",
  cis: "1.1",
  os: MACOS_ONLY,
  requires: ["updates"],
  evidenceKeys: ["pendingCount"],
  evidenceVocabulary: {},
  explanation:
    "An update is ready but has not been installed. Until it is, your Mac still has whatever problem the update fixes, and the fix itself tells attackers exactly where to look. Installing it usually means a restart and a few minutes of waiting.",
  fix: {
    summary: "Install the waiting update from Software Update.",
    settingsPath: ["System Settings", "General", "Software Update"],
    settingsPane: "software_update",
    commands: [
      {
        program: "softwareupdate",
        args: ["-ia"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Save your work and plug the Mac in.",
      "Open System Settings, then General, then Software Update, and click Update Now or Restart Now.",
      "Let the Mac restart and finish installing before you use it again.",
    ],
    verify: "Software Update says your Mac is up to date.",
    effort: "half_hour",
    sideEffects: "restart",
    apply: {
      kind: "deep_link",
      pane: "software_update",
      watch: ["updates"],
      watchEvery: 10,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "updates");
    if (data.pendingCount === null) {
      return unknown("indeterminate");
    }
    const evidence = [ev.number("pendingCount", "Updates waiting", data.pendingCount, "count")];
    return data.pendingCount === 0 ? pass(evidence) : fail(evidence);
  },
};
