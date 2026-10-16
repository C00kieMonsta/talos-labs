import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notFalse, pass, section, TRI_VOCABULARY } from "../helpers";

export const TL_MAC_008: Rule = {
  id: "TL-MAC-008",
  title: "macOS updates install automatically",
  failTitle: "Updates to macOS do not install automatically",
  severity: "medium",
  category: "updates",
  cis: "1.3",
  os: MACOS_ONLY,
  requires: ["updates"],
  evidenceKeys: ["autoInstallOs"],
  evidenceVocabulary: { autoInstallOs: TRI_VOCABULARY },
  explanation:
    "Apple fixes security holes in macOS with each update, and attackers start using those holes as soon as the fix is public. With automatic installs on, your Mac applies updates overnight while it is plugged in. With it off, you stay exposed until you do it by hand.",
  fix: {
    summary: "Turn on automatic installation of macOS updates.",
    settingsPath: ["System Settings", "General", "Software Update"],
    settingsPane: "software_update",
    commands: [
      {
        program: "defaults",
        args: [
          "write",
          "/Library/Preferences/com.apple.SoftwareUpdate",
          "AutomaticallyInstallMacOSUpdates",
          "-bool",
          "true",
        ],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Open System Settings, then General, then Software Update, and click the (i) next to Automatic Updates.",
      "Switch on Install macOS updates.",
    ],
    verify: "Install macOS updates shows as on in the Automatic Updates sheet.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "in_app",
      choice: "none",
      passphrase: false,
      needsPassword: true,
      recheck: ["updates"],
      confirmTitle: "Install macOS updates automatically?",
      confirmVerb: "Turn on",
      confirmNote: null,
      reversible: "You can switch it off again in System Settings > General > Software Update.",
    },
  },
  evaluate(state) {
    const data = section(state, "updates");
    const evidence = [ev.tri("autoInstallOs", "Install macOS updates", data.autoInstallOs)];
    return notFalse(data.autoInstallOs) ? pass(evidence) : fail(evidence);
  },
};
