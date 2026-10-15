import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_013: Rule = {
  id: "TL-MAC-013",
  title: "The screen locks itself within 20 minutes",
  severity: "medium",
  category: "access_control",
  cis: "2.11.1",
  os: MACOS_ONLY,
  requires: ["screenLock"],
  evidenceKeys: ["screensaverIdleSeconds", "usesOsDefault"],
  evidenceVocabulary: {},
  explanation:
    "If you walk away from your Mac, the screen should lock itself before long. With the screen saver set to start after more than 20 minutes, or never, your open email and files stay available to anyone nearby. Twenty minutes or less is the usual recommendation.",
  fix: {
    summary: "Start the screen saver after 20 minutes of inactivity or less.",
    settingsPath: ["System Settings", "Lock Screen"],
    settingsPane: "lock_screen",
    commands: [
      {
        program: "defaults",
        args: ["-currentHost", "write", "com.apple.screensaver", "idleTime", "-int", "1200"],
        needsAdmin: false,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Open System Settings, then Lock Screen.",
      "Set Start Screen Saver when inactive to 20 minutes or less.",
    ],
    verify: "Lock Screen shows 20 minutes or less for Start Screen Saver when inactive.",
    effort: "two_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    const data = section(state, "screenLock");
    if (data.screensaverIdleSeconds === "unset") {
      return pass([ev.bool("usesOsDefault", "Uses the macOS default (20 minutes)", true)]);
    }
    const evidence = [
      ev.number("screensaverIdleSeconds", "Screen saver starts after", data.screensaverIdleSeconds, "seconds"),
    ];
    const ok = data.screensaverIdleSeconds >= 1 && data.screensaverIdleSeconds <= 1200;
    return ok ? pass(evidence) : fail(evidence);
  },
};
