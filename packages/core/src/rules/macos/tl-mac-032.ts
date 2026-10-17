import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const AIRDROP_VOCABULARY: readonly string[] = ["everyone", "contacts_only", "off", "unset"];

export const TL_MAC_032: Rule = {
  id: "TL-MAC-032",
  title: "AirDrop is limited to people you know",
  failTitle: "AirDrop is open to everyone",
  severity: "medium",
  category: "sharing",
  cis: "2.3.1.1",
  os: MACOS_ONLY,
  requires: ["remoteAccess"],
  evidenceKeys: ["airdrop"],
  evidenceVocabulary: { airdrop: AIRDROP_VOCABULARY },
  explanation:
    "AirDrop set to Everyone lets any Mac, iPhone or iPad nearby offer this Mac a file or a picture with one tap, and the request pops up over whatever you are doing. In a cafe, on a train or in a hotel that means strangers. Contacts Only keeps the same convenience for the people in your address book. The benchmark asks for AirDrop to be off; this check accepts Contacts Only, because that is the setting most people can live with.",
  guided: {
    headline: "Anyone nearby can send you files",
    why: "Strangers can push files and pictures to your Mac.",
    verb: "Show me where",
    done: "Done. Only people you know can send you files now.",
    where: "Under \"AirDrop\", choose \"Contacts Only\".",
  },
  fix: {
    summary: "Set AirDrop to Contacts Only, or turn it off, in the AirDrop & Handoff settings.",
    settingsPath: ["System Settings", "General", "AirDrop & Handoff"],
    settingsPane: "airdrop",
    commands: [],
    steps: [
      "Open System Settings, then General, then AirDrop & Handoff, and set AirDrop to Contacts Only.",
      "If you never use AirDrop, choose No One instead.",
      "The AirDrop menu offers Everyone for 10 Minutes; it switches back on its own, so a one-off choice there is fine.",
    ],
    verify: "Run the check-up again; AirDrop reads Contacts Only or off.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "deep_link",
      pane: "airdrop",
      watch: ["remoteAccess"],
      watchEvery: 3,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "remoteAccess");
    const evidence = [ev.enum("airdrop", "AirDrop", data.airdrop)];
    return data.airdrop === "everyone" ? fail(evidence) : pass(evidence);
  },
};
