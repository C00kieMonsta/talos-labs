import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notFalse, pass, section, TRI_VOCABULARY } from "../helpers";

export const TL_MAC_007: Rule = {
  id: "TL-MAC-007",
  title: "Updates are checked and downloaded automatically",
  failTitle: "Updates are not checked or downloaded automatically",
  severity: "medium",
  category: "updates",
  cis: "1.2",
  os: MACOS_ONLY,
  requires: ["updates"],
  evidenceKeys: ["automaticCheck", "automaticDownload"],
  evidenceVocabulary: { automaticCheck: TRI_VOCABULARY, automaticDownload: TRI_VOCABULARY },
  explanation:
    "Most security fixes arrive as updates. When your Mac checks for them and downloads them on its own, you only need to approve the install. With these switches off, nothing happens until you remember to look, and attackers count on people forgetting.",
  fix: {
    summary: "Turn on automatic checking and downloading of updates.",
    settingsPath: ["System Settings", "General", "Software Update"],
    settingsPane: "software_update",
    commands: [
      {
        program: "defaults",
        args: ["write", "/Library/Preferences/com.apple.SoftwareUpdate", "AutomaticCheckEnabled", "-bool", "true"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
      {
        program: "defaults",
        args: ["write", "/Library/Preferences/com.apple.SoftwareUpdate", "AutomaticDownload", "-bool", "true"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Open System Settings, then General, then Software Update, and click the (i) next to Automatic Updates.",
      "Switch on Check for updates and Download new updates when available.",
    ],
    verify: "Both switches show as on in the Automatic Updates sheet.",
    effort: "two_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    const data = section(state, "updates");
    const evidence = [
      ev.tri("automaticCheck", "Check for updates", data.automaticCheck),
      ev.tri("automaticDownload", "Download new updates", data.automaticDownload),
    ];
    return notFalse(data.automaticCheck) && notFalse(data.automaticDownload) ? pass(evidence) : fail(evidence);
  },
};
