import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notFalse, pass, section, TRI_VOCABULARY } from "../helpers";

export const TL_MAC_009: Rule = {
  id: "TL-MAC-009",
  title: "Security fixes install automatically",
  failTitle: "Security fixes do not install automatically",
  severity: "high",
  category: "updates",
  cis: "1.5",
  os: MACOS_ONLY,
  requires: ["updates"],
  evidenceKeys: ["autoInstallSecurityResponses"],
  evidenceVocabulary: { autoInstallSecurityResponses: TRI_VOCABULARY },
  explanation:
    "Security Responses are small, urgent fixes Apple sends between full updates, often for problems already being used in attacks. They install in minutes and rarely need a restart. Leaving this off means the fastest fixes Apple ships never reach you.",
  fix: {
    summary: "Turn on automatic installation of Security Responses and system files.",
    settingsPath: ["System Settings", "General", "Software Update"],
    settingsPane: "software_update",
    commands: [
      {
        program: "defaults",
        args: ["write", "/Library/Preferences/com.apple.SoftwareUpdate", "ConfigDataInstall", "-bool", "true"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
      {
        program: "defaults",
        args: ["write", "/Library/Preferences/com.apple.SoftwareUpdate", "CriticalUpdateInstall", "-bool", "true"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Open System Settings, then General, then Software Update, and click the (i) next to Automatic Updates.",
      "Switch on Install Security Responses and system files.",
    ],
    verify: "Install Security Responses and system files shows as on in the Automatic Updates sheet.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "in_app",
      choice: "none",
      passphrase: false,
      needsPassword: true,
      recheck: ["updates"],
      confirmTitle: "Install security fixes automatically?",
      confirmVerb: "Turn on",
      confirmNote: null,
      reversible: "You can switch it off again in System Settings > General > Software Update.",
    },
  },
  evaluate(state) {
    const data = section(state, "updates");
    const evidence = [
      ev.tri("autoInstallSecurityResponses", "Install Security Responses", data.autoInstallSecurityResponses),
    ];
    return notFalse(data.autoInstallSecurityResponses) ? pass(evidence) : fail(evidence);
  },
};
