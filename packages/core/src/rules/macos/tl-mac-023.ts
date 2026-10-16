import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, MACOS_ONLY, pass, review, section } from "../helpers";

export const TL_MAC_023: Rule = {
  id: "TL-MAC-023",
  title: "No program is set to start in the background",
  failTitle: "Some programs start in the background on their own",
  severity: "info",
  category: "persistence",
  cis: null,
  os: MACOS_ONLY,
  requires: ["persistence"],
  evidenceKeys: ["itemCount", "itemLabel", "agentPlist", "daemonPlist"],
  evidenceVocabulary: {},
  explanation:
    "Some programs on this Mac are set to start on their own, in the background, every time you log in or the Mac starts. Most are harmless helpers from apps you installed, but this is also the usual way malware makes sure it keeps running. It is worth looking down the list once and removing anything you do not recognise or no longer use.",
  fix: {
    summary: "Review the background items and remove any you do not recognise.",
    settingsPath: ["System Settings", "General", "Login Items & Extensions", "Allow in the Background"],
    settingsPane: "login_items",
    commands: [
      {
        program: "launchctl",
        args: ["bootout", "gui/$UID", "{path}"],
        needsAdmin: false,
        interactive: false,
        appliesTo: "agentPlist",
      },
      {
        program: "launchctl",
        args: ["bootout", "system", "{path}"],
        needsAdmin: true,
        interactive: false,
        appliesTo: "daemonPlist",
      },
    ],
    steps: [
      "Open System Settings, then General, then Login Items & Extensions, and look under Allow in the Background.",
      "Switch off anything you do not recognise. If the app it belongs to is no longer installed, switch it off too.",
      "Advanced: an item that is not listed there can be removed by deleting the plist file shown in the evidence and restarting the Mac.",
    ],
    verify: "Run the check-up again; the item no longer appears in the evidence.",
    effort: "ten_minutes",
    sideEffects: "workflow",
    apply: {
      kind: "deep_link",
      pane: "login_items",
      watch: ["persistence"],
      watchEvery: 3,
      reveal: "plist",
    },
  },
  evaluate(state) {
    const data = section(state, "persistence");
    const evidence: Evidence[] = [ev.number("itemCount", "Background items", data.items.length, "count")];
    for (const item of data.items) {
      evidence.push(ev.text("itemLabel", "Item", item.label));
      if (item.scope === "system_daemon") {
        evidence.push(ev.path("daemonPlist", "Daemon file", item.plistPath));
      } else {
        evidence.push(ev.path("agentPlist", "Agent file", item.plistPath));
      }
    }
    return data.items.length === 0 ? pass(evidence) : review(evidence);
  },
};
