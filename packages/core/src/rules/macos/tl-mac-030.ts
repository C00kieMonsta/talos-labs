import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notApplicable, pass, section, unknown } from "../helpers";

export const PRIVATE_DIR_MODES: readonly string[] = ["700"];
export const PRIVATE_KEY_MODES: readonly string[] = ["600", "400"];

export const TL_MAC_030: Rule = {
  id: "TL-MAC-030",
  title: "Your SSH folder is private",
  severity: "medium",
  category: "developer",
  cis: null,
  os: MACOS_ONLY,
  requires: ["ssh"],
  evidenceKeys: ["dirPrivate", "dirMode", "looseKeyCount", "keyPath", "keyMode"],
  evidenceVocabulary: {},
  explanation:
    "Your .ssh folder, or a key inside it, can be read by other accounts on this Mac. The keys in that folder are what log you in to servers and services, so they should be readable by you alone. SSH itself refuses to use a key that is too open, so this also causes confusing login failures.",
  fix: {
    summary: "Make the .ssh folder and each key readable by you only.",
    settingsPath: null,
    settingsPane: null,
    commands: [
      {
        program: "chmod",
        args: ["600", "{path}"],
        needsAdmin: false,
        interactive: false,
        appliesTo: "keyPath",
      },
    ],
    steps: [
      "Open Terminal and run chmod 700 ~/.ssh so only your account can open the folder.",
      "Run the command shown for each key listed in the evidence so only your account can read it.",
    ],
    verify: "Run ls -la ~/.ssh in Terminal. The folder shows drwx------ and each private key shows -rw------- or -r--------.",
    effort: "two_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    const data = section(state, "ssh");
    if (!data.dirExists) {
      return notApplicable();
    }
    if (data.dirMode === null) {
      return unknown("indeterminate");
    }
    const dirPrivate = PRIVATE_DIR_MODES.includes(data.dirMode);
    const loose = data.keys.filter((key) => key.mode !== null && !PRIVATE_KEY_MODES.includes(key.mode));
    const evidence: Evidence[] = [
      ev.bool("dirPrivate", "Folder readable by you only", dirPrivate),
      ev.text("dirMode", "Folder permissions", data.dirMode),
      ev.number("looseKeyCount", "Keys readable by others", loose.length, "count"),
    ];
    for (const key of loose) {
      evidence.push(ev.path("keyPath", "Key file", key.path));
      evidence.push(ev.text("keyMode", "Key permissions", key.mode ?? ""));
    }
    return dirPrivate && loose.length === 0 ? pass(evidence) : fail(evidence);
  },
};
