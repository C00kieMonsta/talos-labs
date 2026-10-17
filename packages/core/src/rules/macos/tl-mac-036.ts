import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section, unknown } from "../helpers";

export const TL_MAC_036: Rule = {
  id: "TL-MAC-036",
  title: "Nothing is loaded into every app you open",
  failTitle: "Something is loaded into every app you open",
  severity: "medium",
  category: "persistence",
  cis: null,
  os: MACOS_ONLY,
  requires: ["platformIntegrity"],
  evidenceKeys: ["dyldInsertSet", "loginHookSet", "launchdConfPresent"],
  evidenceVocabulary: {},
  explanation:
    "macOS keeps a few old switches that make it load extra code into every app you start or run a script at every login: an environment variable that inserts a library into each program, a login or logout hook, and a system file launchd stopped reading years ago. None of them is set on a normal Mac. Malware uses them to hide inside other apps and to come back after a restart. This check reads the running session and those files; a launch item that sets the variable again at login is listed by the background programs check, not here.",
  guided: {
    headline: "An extra file is added to every app you open",
    why: "Bad software uses this to hide inside other apps.",
    verb: "Details",
    done: "Done. Get help if this comes back after you log in again.",
    where: null,
  },
  fix: {
    summary: "Get help from someone you trust before changing anything.",
    settingsPath: null,
    settingsPane: null,
    commands: [],
    steps: [
      "Get help from someone you trust; this is not something to fix alone.",
      "Write down what the check-up shows and when you first saw it.",
      "Logging out and back in clears the inserted library for the session. If it comes back, something on the Mac sets it again at login, and that is the thing to find.",
    ],
    verify: "After logging out and back in, run the check-up again; this check passes and stays passed.",
    effort: "half_hour",
    sideEffects: "workflow",
    apply: {
      kind: "manual",
      watch: ["platformIntegrity"],
      watchEvery: 5,
      reveal: null,
    },
  },
  evaluate(state) {
    const inserts = section(state, "platformIntegrity").inserts;
    if (inserts.status !== "ok") {
      return unknown(inserts.reason);
    }
    const data = inserts.data;
    const evidence = [
      ev.bool("dyldInsertSet", "Library insert variable set", data.dyldInsertSet),
      ev.bool("loginHookSet", "Login or logout hook set", data.loginHookSet),
      ev.bool("launchdConfPresent", "Legacy launchd file present", data.launchdConfPresent),
    ];
    const loaded = data.dyldInsertSet || data.loginHookSet || data.launchdConfPresent;
    return loaded ? fail(evidence) : pass(evidence);
  },
};
