import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_024: Rule = {
  id: "TL-MAC-024",
  title: "No background program points at a missing file",
  failTitle: "A background program points at a missing file",
  severity: "medium",
  category: "persistence",
  cis: null,
  os: MACOS_ONLY,
  requires: ["persistence"],
  evidenceKeys: ["orphanCount", "orphanPlist", "orphanProgram"],
  evidenceVocabulary: {},
  explanation:
    "A background item on this Mac is set to run a program that no longer exists, usually left behind by an app that was deleted. That sounds harmless, but the Mac will still try to run whatever appears at that path. An attacker who gets a file there later would have it started for them, with no extra setup.",
  fix: {
    summary: "Delete the leftover background item that points at a missing program.",
    settingsPath: null,
    settingsPane: null,
    commands: [],
    steps: [
      "In Finder, choose Go, then Go to Folder, and paste the plist path shown in the evidence.",
      "Move that plist file to the Bin. You may be asked for an administrator password for files under /Library.",
      "Restart the Mac, or log out and back in, so the item is no longer loaded.",
    ],
    verify: "Run the check-up again; the orphan count is 0.",
    effort: "two_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    const data = section(state, "persistence");
    const orphans = data.items.filter((item) => item.programExists === false);
    const evidence: Evidence[] = [ev.number("orphanCount", "Items pointing at a missing program", orphans.length, "count")];
    for (const item of orphans) {
      evidence.push(ev.path("orphanPlist", "Item file", item.plistPath));
      if (item.program !== null) {
        evidence.push(ev.path("orphanProgram", "Missing program", item.program));
      }
    }
    return orphans.length === 0 ? pass(evidence) : fail(evidence);
  },
};
