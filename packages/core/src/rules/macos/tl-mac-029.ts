import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import type { SshKey } from "../../domain/system-state";
import { ev, fail, MACOS_ONLY, notApplicable, pass, section } from "../helpers";

/** PEM and PKCS#8 keys get their own evidence key so the fix command keeps their format. */
function keyPathEvidence(key: SshKey): Evidence {
  switch (key.format) {
    case "pem":
      return ev.path("pemKeyPath", "Key file (PEM)", key.path);
    case "pkcs8":
      return ev.path("pkcs8KeyPath", "Key file (PKCS#8)", key.path);
    default:
      return ev.path("keyPath", "Key file", key.path);
  }
}

export const TL_MAC_029: Rule = {
  id: "TL-MAC-029",
  title: "SSH keys are protected by a passphrase",
  failTitle: "An SSH key has no passphrase",
  severity: "high",
  category: "developer",
  cis: null,
  os: MACOS_ONLY,
  requires: ["ssh"],
  evidenceKeys: ["keyCount", "unprotectedCount", "unrecognisedCount", "keyPath", "pemKeyPath", "pkcs8KeyPath"],
  evidenceVocabulary: {},
  explanation:
    "An SSH key is a file that logs you in to servers and services such as GitHub without a password. At least one of yours is stored with no passphrase, so anyone who copies the file, through malware, a stolen backup or a shared Mac, can use it as you straight away. Adding a passphrase means the file alone is useless to them.",
  fix: {
    summary: "Add a passphrase to each unprotected SSH key.",
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
      {
        program: "ssh-keygen",
        args: ["-p", "-m", "PEM", "-f", "{path}"],
        needsAdmin: false,
        interactive: true,
        appliesTo: "pemKeyPath",
      },
      {
        program: "ssh-keygen",
        args: ["-p", "-m", "PKCS8", "-f", "{path}"],
        needsAdmin: false,
        interactive: true,
        appliesTo: "pkcs8KeyPath",
      },
    ],
    steps: [
      "Open Terminal and run the command shown for each key. It asks for the old passphrase (press Return if there is none) and then for a new one, twice.",
      "For .pem and PKCS#8 keys the command includes -m PEM or -m PKCS8 so the file keeps its format and tools such as the AWS CLI and OpenSSL can still read it.",
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
      evidence.push(keyPathEvidence(key));
    }
    return unprotected.length === 0 ? pass(evidence) : fail(evidence);
  },
};
