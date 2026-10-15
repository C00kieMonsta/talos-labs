import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, MACOS_ONLY, pass, review, section } from "../helpers";

export const CIS_MIN_PASSWORD_LENGTH = 15;

export const TL_MAC_017: Rule = {
  id: "TL-MAC-017",
  title: "Short passwords are not allowed",
  severity: "info",
  category: "access_control",
  cis: "5.2.2",
  os: MACOS_ONLY,
  requires: ["passwordPolicy"],
  evidenceKeys: ["policySet", "minLength"],
  evidenceVocabulary: {},
  explanation:
    "This checks the password rule set on the Mac itself, not your actual password. The security benchmark recommends requiring at least 15 characters, and your Mac does not enforce that, so a short password is allowed. A long passphrase is still the best thing you can choose, whatever the policy says.",
  fix: {
    summary: "Use a login password of 15 or more characters; optionally set the policy with pwpolicy.",
    settingsPath: null,
    settingsPane: null,
    commands: [],
    steps: [
      "Choose a login password or passphrase of 15 or more characters. This is good practice even though it does not change the policy.",
      "Advanced, optional: write the CIS password policy as a plist file, then run pwpolicy -setaccountpolicies with that file as an administrator.",
    ],
    verify:
      "Run pwpolicy getaccountpolicies in Terminal. The policyAttributePassword content should contain .{15,}. This check reads that policy, not your password.",
    effort: "ten_minutes",
    sideEffects: "none",
  },
  evaluate(state) {
    const data = section(state, "passwordPolicy");
    const evidence: Evidence[] = [ev.bool("policySet", "Minimum length policy set", data.minLength !== null)];
    if (data.minLength !== null) {
      evidence.push(ev.number("minLength", "Minimum password length", data.minLength, "chars"));
    }
    const ok = data.minLength !== null && data.minLength >= CIS_MIN_PASSWORD_LENGTH;
    return ok ? pass(evidence) : review(evidence);
  },
};
