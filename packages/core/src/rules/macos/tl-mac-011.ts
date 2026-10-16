import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notFalse, pass, section, TRI_VOCABULARY } from "../helpers";

export const TL_MAC_011: Rule = {
  id: "TL-MAC-011",
  title: "App Store apps update automatically",
  failTitle: "App Store apps do not update automatically",
  severity: "low",
  category: "updates",
  cis: "1.4",
  os: MACOS_ONLY,
  requires: ["updates"],
  evidenceKeys: ["appStoreAutoUpdate"],
  evidenceVocabulary: { appStoreAutoUpdate: TRI_VOCABULARY },
  explanation:
    "Apps from the App Store get their own security fixes, separate from macOS. With automatic updates on, they are patched without you doing anything. With it off, an old browser or messaging app can stay vulnerable for months.",
  fix: {
    summary: "Turn on Automatic Updates in the App Store settings.",
    settingsPath: ["App Store", "Settings", "Automatic Updates"],
    settingsPane: null,
    commands: [
      {
        program: "defaults",
        args: ["write", "/Library/Preferences/com.apple.commerce", "AutoUpdate", "-bool", "true"],
        needsAdmin: true,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Open the App Store app.",
      "In the menu bar choose App Store, then Settings.",
      "Tick Automatic Updates.",
    ],
    verify: "App Store > Settings shows Automatic Updates ticked.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "in_app",
      choice: "none",
      passphrase: false,
      needsPassword: true,
      recheck: ["updates"],
      confirmTitle: "Update App Store apps automatically?",
      confirmVerb: "Turn on",
      confirmNote: null,
      reversible: "You can switch it off again in App Store > Settings.",
    },
  },
  evaluate(state) {
    const data = section(state, "updates");
    const evidence = [ev.tri("appStoreAutoUpdate", "App Store automatic updates", data.appStoreAutoUpdate)];
    return notFalse(data.appStoreAutoUpdate) ? pass(evidence) : fail(evidence);
  },
};
