import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notApplicable, pass, section } from "../helpers";

export const TL_MAC_029: Rule = {
  id: "TL-MAC-029",
  title: "SSH keys are protected by a passphrase",
  severity: "high",
  category: "developer",
  cis: null,
  os: MACOS_ONLY,
  requires: ["ssh"],
  evidenceKeys: ["keyCount", "unprotectedCount", "unrecognisedCount", "keyPath"],
  evidenceVocabulary: {},
  explanation:
    "An SSH key is a file that logs you in to servers and services such as GitHub without a password. One of yours is stored with no passphrase, so anyone who copies the file, through malware, a stolen backup or a shared Mac, can use it as you straight away. Adding a passphrase means the file alone is useless to them.",
  fix: {
    summary: "Add a passphrase to each unprotected SSH key with ssh-keygen.",
    settingsPath: null,
    settingsPane: null,
    commands: [
      {
        program: "ssh-keygen",
        args: ["-p", "-f", "{path}"],
        needsAdmin: false,
        interactive: true,
        appliesTo: "keyPath",
      },
    ],
    steps: [
      "Open Terminal and run the command shown for each key. It asks for the old passphrase (press Return if there is none) and then for a new one, twice.",
      "Choose a passphrase you can remember; a few unrelated words works well.",
      "To avoid typing it every time, run ssh-add --apple-use-keychain with the key path once, and the Mac keychain will supply it.",
    ],
    verify: "Run the check-up again; the unprotected key count is 0.",
    effort: "two_minutes",
    sideEffects: "workflow",
  },
  evaluate(state) {
    const data = section(state, "ssh");
    if (data.keys.length === 0) {
      return notApplicable();
    }
    const unprotected = data.keys.filter((key) => key.encrypted === false);
    const unrecognised = data.keys.filter((key) => key.encrypted === null);
    const evidence: Evidence[] = [
      ev.number("keyCount", "SSH keys found", data.keys.length, "count"),
      ev.number("unprotectedCount", "Keys without a passphrase", unprotected.length, "count"),
      ev.number("unrecognisedCount", "Keys in an unrecognised format", unrecognised.length, "count"),
    ];
    for (const key of unprotected) {
      evidence.push(ev.path("keyPath", "Key file", key.path));
    }
    return unprotected.length === 0 ? pass(evidence) : fail(evidence);
  },
};
