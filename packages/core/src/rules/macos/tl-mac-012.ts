import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_012: Rule = {
  id: "TL-MAC-012",
  title: "A password is needed right after the screen locks",
  failTitle: "A password is not needed right after the screen locks",
  severity: "high",
  category: "access_control",
  cis: "2.11.2",
  os: MACOS_ONLY,
  requires: ["screenLock"],
  evidenceKeys: ["requirePassword", "delaySeconds"],
  evidenceVocabulary: {},
  explanation:
    "When the screen locks, a password should be needed straight away to get back in. If there is a delay, anyone who walks up in that window can use your Mac as you. Setting it to immediately closes the gap.",
  guided: {
    headline: "Your Mac stays unlocked after the screen goes dark",
    why: "Anyone walking past can use it before a password is asked.",
    verb: "Show me where",
    done: "Done. A password is asked right away.",
    where: "Next to \"Require password after screen saver begins\", choose \"Immediately\".",
  },
  fix: {
    summary: "Require the password immediately after the screen saver begins or the display turns off.",
    settingsPath: ["System Settings", "Lock Screen"],
    settingsPane: "lock_screen",
    commands: [
      {
        program: "sysadminctl",
        args: ["-screenLock", "immediate", "-password", "-"],
        needsAdmin: false,
        interactive: true,
        appliesTo: null,
      },
    ],
    steps: [
      "Open System Settings, then Lock Screen.",
      "Set Require password after screen saver begins or display is turned off to Immediately.",
    ],
    verify: "Lock Screen shows Immediately.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "deep_link",
      pane: "lock_screen",
      watch: ["screenLock"],
      watchEvery: 3,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "screenLock");
    const evidence: Evidence[] = [ev.bool("requirePassword", "Password required", data.requirePassword)];
    if (data.delaySeconds !== null) {
      evidence.push(ev.number("delaySeconds", "Delay before password", data.delaySeconds, "seconds"));
    }
    const ok = data.requirePassword && data.delaySeconds !== null && data.delaySeconds <= 5;
    return ok ? pass(evidence) : fail(evidence);
  },
};
