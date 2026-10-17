import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { SIGNATURE_WORDS } from "../../domain/system-state.guard";
import { ev, fail, MACOS_ONLY, pass, section, unknown } from "../helpers";

export const TL_MAC_035: Rule = {
  id: "TL-MAC-035",
  title: "Every app came through the usual safety checks",
  failTitle: "An app on your Mac was not checked",
  severity: "medium",
  category: "platform",
  cis: null,
  os: MACOS_ONLY,
  requires: ["platformIntegrity"],
  evidenceKeys: ["bundleCount", "checkedCount", "flaggedCount", "bundlePath", "signature"],
  evidenceVocabulary: { signature: SIGNATURE_WORDS },
  explanation:
    "When you download an app, macOS marks it and checks its signature the first time it opens. Those checks, Gatekeeper and notarisation, are what stop known bad software. An app in your Applications folder with no signature and no mark was never checked, which is how a program slips in by another route: a copied folder, an installer script, or a file put there by something that was already running. Apps whose signature breaks in place, and apps a developer signed only for themselves, are listed for information and do not fail this check.",
  guided: {
    headline: "An app skipped the usual safety checks",
    why: "macOS did not check this app before it opened.",
    verb: "Details",
    done: "Done. Have a look at the app, and get help if you don't know it.",
    where: null,
  },
  fix: {
    summary: "Look at the app named and ask someone you trust before opening it again.",
    settingsPath: null,
    settingsPane: null,
    commands: [],
    steps: [
      "In Finder, look at the app shown. If you did not install it, get help before you open it again.",
      "If you know the app and chose it on purpose, you can leave it; the check keeps listing it until it is gone.",
      "An app you no longer want can go in the Bin from Finder; nothing here removes anything for you.",
    ],
    verify: "Run the check-up again; no app is listed as unchecked.",
    effort: "ten_minutes",
    sideEffects: "workflow",
    apply: {
      kind: "manual",
      watch: ["platformIntegrity"],
      watchEvery: 5,
      reveal: "file",
    },
  },
  evaluate(state) {
    const apps = section(state, "platformIntegrity").apps;
    if (apps.status !== "ok") {
      return unknown(apps.reason);
    }
    const data = apps.data;
    const evidence: Evidence[] = [
      ev.number("bundleCount", "Apps in the Applications folders", data.bundleCount, "count"),
      ev.number("checkedCount", "Apps whose signature was read", data.checkedCount, "count"),
      ev.number("flaggedCount", "Apps with no signature from a known source and no download mark", data.flagged.length, "count"),
    ];
    for (const bundle of data.flagged) {
      evidence.push(ev.path("bundlePath", "App", bundle.path));
      evidence.push(ev.enum("signature", "Signature", bundle.signature));
    }
    // An adhoc signature is a developer's own build and only ever evidence; a broken one never fails here.
    const unchecked = data.flagged.some((bundle) => bundle.signature === "unsigned" && !bundle.quarantined);
    return unchecked ? fail(evidence) : pass(evidence);
  },
};
