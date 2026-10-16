import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, notApplicable, pass, section } from "../helpers";

export const TL_MAC_004: Rule = {
  id: "TL-MAC-004",
  title: "Only apps from known developers can open",
  failTitle: "Apps from unknown developers can open",
  severity: "high",
  category: "platform",
  cis: "2.6.5",
  os: MACOS_ONLY,
  requires: ["platformIntegrity"],
  evidenceKeys: ["execPolicyEnabled"],
  evidenceVocabulary: {},
  explanation:
    "Gatekeeper checks that an app comes from the App Store or from a developer Apple knows before it is allowed to open. With that check off, a download that pretends to be a document or an installer can run without any warning. Keeping it on is the main thing that stops malware from being double-clicked into life.",
  fix: {
    summary: "Set Allow applications from to App Store & Known Developers.",
    settingsPath: ["System Settings", "Privacy & Security", "Security"],
    settingsPane: "security",
    commands: [],
    steps: [
      "Open System Settings, then Privacy & Security, and scroll to the Security heading.",
      "Under Allow applications from, choose App Store & Known Developers.",
    ],
    verify: "Privacy & Security shows App Store & Known Developers under Allow applications from.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "deep_link",
      pane: "security",
      watch: ["platformIntegrity"],
      watchEvery: 3,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "platformIntegrity");
    if (data.execPolicyEnabled === null) {
      return notApplicable();
    }
    const evidence = [ev.bool("execPolicyEnabled", "Gatekeeper on", data.execPolicyEnabled)];
    return data.execPolicyEnabled ? pass(evidence) : fail(evidence);
  },
};
