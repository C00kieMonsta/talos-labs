import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_006: Rule = {
  id: "TL-MAC-006",
  title: "Built-in malware protection is present",
  failTitle: "Built-in malware protection is missing or cannot be read",
  severity: "medium",
  category: "platform",
  cis: "5.10",
  os: MACOS_ONLY,
  requires: ["malwareProtection"],
  evidenceKeys: ["engine", "present", "version"],
  evidenceVocabulary: { engine: ["xprotect", "defender", "none"] },
  explanation:
    "XProtect is the malware checker built into macOS. Apple updates its list of known threats quietly through Software Update. If it is missing or its version cannot be read, your Mac may not recognise malware that everyone else is already protected against.",
  guided: {
    headline: "Virus checks are missing",
    why: "macOS checks downloads for known bad software, and this part is not there.",
    verb: "Show me where",
    done: "Done. Virus checks are back.",
    where: "Click \"Update Now\" and wait for it to finish.",
  },
  fix: {
    summary: "Run Software Update so macOS restores and updates its built-in protection.",
    settingsPath: ["System Settings", "General", "Software Update"],
    settingsPane: "software_update",
    commands: [],
    steps: [
      "Open System Settings, then General, then Software Update.",
      "Install anything offered, including background security updates.",
      "Run the check-up again once the update has finished.",
    ],
    verify: "This check passes on the next scan.",
    effort: "ten_minutes",
    sideEffects: "none",
    apply: {
      kind: "deep_link",
      pane: "software_update",
      watch: ["malwareProtection"],
      watchEvery: 3,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "malwareProtection");
    const evidence = [
      ev.enum("engine", "Protection engine", data.engine),
      ev.bool("present", "Engine present", data.present),
    ];
    if (data.version !== null) {
      evidence.push(ev.version("version", "Definitions version", data.version));
    }
    return data.present && data.version !== null ? pass(evidence) : fail(evidence);
  },
};
