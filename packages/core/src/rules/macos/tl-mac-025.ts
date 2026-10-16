import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, MACOS_ONLY, pass, review, section } from "../helpers";

export const TL_MAC_025: Rule = {
  id: "TL-MAC-025",
  title: "No app opens at login",
  failTitle: "Some apps open at login",
  severity: "info",
  category: "persistence",
  cis: null,
  os: MACOS_ONLY,
  requires: ["loginItems"],
  evidenceKeys: ["loginItemCount", "loginItemName"],
  evidenceVocabulary: {},
  explanation:
    "These apps open by themselves every time you log in. That is usually by choice, but an app you forgot about, or one that added itself, keeps running and keeps its access to your files and network. Fewer login items also means a faster start.",
  fix: {
    summary: "Remove login items you do not need from Login Items & Extensions.",
    settingsPath: ["System Settings", "General", "Login Items & Extensions", "Open at Login"],
    settingsPane: "login_items",
    commands: [],
    steps: [
      "Open System Settings, then General, then Login Items & Extensions.",
      "Under Open at Login, select an item you do not need and click the minus button.",
    ],
    verify: "Open at Login lists only the apps you want.",
    effort: "two_minutes",
    sideEffects: "none",
    apply: {
      kind: "deep_link",
      pane: "login_items",
      watch: ["loginItems"],
      watchEvery: 5,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "loginItems");
    const evidence: Evidence[] = [ev.number("loginItemCount", "Apps that open at login", data.count, "count")];
    for (const name of data.names) {
      evidence.push(ev.text("loginItemName", "App", name));
    }
    return data.count === 0 ? pass(evidence) : review(evidence);
  },
};
