import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notApplicable, pass, section } from "../helpers";

export const TL_MAC_005: Rule = {
  id: "TL-MAC-005",
  title: "System protection (SIP) is on",
  failTitle: "System protection (SIP) is off",
  severity: "high",
  category: "platform",
  cis: "5.1.2",
  os: MACOS_ONLY,
  requires: ["platformIntegrity"],
  evidenceKeys: ["systemProtectionEnabled"],
  evidenceVocabulary: {},
  explanation:
    "System Integrity Protection, or SIP, stops any program, even one running as an administrator, from changing the core parts of macOS. With it off, malware that gets onto the Mac can dig into the system itself and hide there. It is on by default and there is rarely a good reason to turn it off.",
  guided: {
    headline: "A built-in safety guard is off",
    why: "It stops programs from changing the parts of macOS that keep you safe.",
    verb: "Details",
    done: "Done. The protection is back on.",
    where: null,
  },
  fix: {
    summary: "Turn System Integrity Protection back on from Recovery.",
    settingsPath: null,
    settingsPane: null,
    commands: [],
    steps: [
      "Save your work and shut the Mac down.",
      "Press and hold the power button until Loading startup options appears, then choose Options and Continue.",
      "In the menu bar choose Utilities, then Terminal.",
      "Type csrutil enable and press Return, then restart the Mac from the Apple menu.",
    ],
    verify: "After the restart, run the check-up again; this check passes.",
    effort: "half_hour",
    sideEffects: "restart",
    apply: {
      kind: "manual",
      watch: [],
      watchEvery: 3,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "platformIntegrity");
    if (data.systemProtectionEnabled === null) {
      return notApplicable();
    }
    const evidence = [ev.bool("systemProtectionEnabled", "SIP on", data.systemProtectionEnabled)];
    return data.systemProtectionEnabled ? pass(evidence) : fail(evidence);
  },
};
