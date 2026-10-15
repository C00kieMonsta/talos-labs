import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import type { UnavailableReason } from "../../domain/system-state";
import { ev, fail, MACOS_ONLY, notApplicable, pass, section, unknown } from "../helpers";

export const BROWSER_VOCABULARY: readonly string[] = ["chrome", "brave", "edge", "arc", "firefox"];

export const TL_MAC_028: Rule = {
  id: "TL-MAC-028",
  title: "Browser extensions are limited to the sites they need",
  failTitle: "A browser extension can read every website",
  severity: "low",
  category: "browser",
  cis: null,
  os: MACOS_ONLY,
  requires: ["browsers"],
  evidenceKeys: ["browserCount", "broadAccessCount", "browser", "extensionName", "uncheckedBrowser"],
  evidenceVocabulary: { browser: BROWSER_VOCABULARY, uncheckedBrowser: BROWSER_VOCABULARY },
  explanation:
    "A browser extension on this Mac is allowed to read and change every website you visit, including your bank and your email. Extensions are sold and updated by people you have never met, and a popular one can turn bad overnight. Limiting each extension to the sites it needs, or to run only when you click it, keeps the damage small if that happens.",
  fix: {
    summary: "Limit each extension to the sites it needs, or set it to run only when you click it.",
    settingsPath: null,
    settingsPane: null,
    commands: [],
    steps: [
      "In the browser, open the extensions page (chrome://extensions in Chrome, Brave, Edge and Arc; about:addons in Firefox).",
      "For each extension named in the evidence, open Details and set Site access to On click, or to the specific sites it needs. Remove extensions you no longer use.",
      "If a browser is listed as not checked, open System Settings, then Privacy & Security, then Full Disk Access, switch on Talos Labs, and run the check-up again. Chrome, Brave, Edge, Arc and Firefox all keep their extension list behind that permission.",
    ],
    verify: "Run the check-up again; no extension is listed with access to every site.",
    effort: "ten_minutes",
    sideEffects: "workflow",
  },
  evaluate(state) {
    const data = section(state, "browsers");
    if (data.installed.length === 0) {
      return notApplicable();
    }
    const hits: Evidence[] = [];
    const unchecked: Evidence[] = [];
    let firstReason: UnavailableReason | null = null;
    for (const report of data.installed) {
      if (report.extensions.status === "ok") {
        for (const extension of report.extensions.data) {
          if (extension.broadHostAccess) {
            hits.push(ev.enum("browser", "Browser", report.browser));
            hits.push(ev.text("extensionName", "Extension", extension.name));
          }
        }
      } else {
        unchecked.push(ev.enum("uncheckedBrowser", "Browser not checked", report.browser));
        firstReason ??= report.extensions.reason;
      }
    }
    const broadCount = hits.length / 2;
    const evidence: Evidence[] = [
      ev.number("browserCount", "Browsers installed", data.installed.length, "count"),
      ev.number("broadAccessCount", "Extensions found with access to every site", broadCount, "count"),
      ...hits,
      ...unchecked,
    ];
    if (broadCount > 0) {
      return fail(evidence);
    }
    if (firstReason !== null) {
      return unknown(firstReason, evidence);
    }
    return pass(evidence);
  },
};
