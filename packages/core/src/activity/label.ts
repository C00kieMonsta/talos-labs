import type { SectionKey } from "../domain/system-state";
import type { ProbeId } from "../ports/watch-port";
import { MACOS_CATALOG } from "../rules/macos/index";
import type { ActivityEvent } from "./types";

/** Strings passed in from the desktop copy, so core stays string-free. */
export interface ActivityStrings {
  readonly preparing: string;
  readonly batchAdmin: string;
  readonly batchAdminOne: string;
  readonly checking: string;
  readonly watching: string;
  readonly watchCheck: string;
  readonly verbs: Readonly<Record<string, string>>;
  readonly probes: Readonly<Record<ProbeId, string>>;
  readonly sections: Readonly<Record<SectionKey, string>>;
}

function raiseFirst(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** The row's authored label. Never a raw field and never the model line. */
export function activityLabel(event: ActivityEvent, strings: ActivityStrings): string {
  switch (event.kind) {
    case "preparing":
      return strings.preparing;
    case "fixing": {
      if (event.ruleId === null) return event.count === 1 ? strings.batchAdminOne : strings.batchAdmin.replace("{n}", String(event.count ?? 0));
      const ruleId = event.ruleId;
      const verb = MACOS_CATALOG.rules.find((r) => r.id === ruleId)?.guided.verb ?? "";
      return strings.verbs[verb] ?? verb;
    }
    case "rechecking":
      return strings.checking;
    case "watching":
      return strings.watching;
    case "watch_check":
      return strings.watchCheck;
    case "probe":
      return event.probeId === null ? "" : raiseFirst(strings.probes[event.probeId]);
    case "section":
      return event.sectionKey === null ? "" : strings.sections[event.sectionKey];
  }
}
