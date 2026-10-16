import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const BACKUP_METHOD_VOCABULARY: readonly string[] = ["time_machine", "windows_backup", "none"];

export const TL_MAC_026: Rule = {
  id: "TL-MAC-026",
  title: "Backups are set up",
  failTitle: "No backup is set up",
  severity: "medium",
  category: "backup",
  cis: "2.3.4.1",
  os: MACOS_ONLY,
  requires: ["backup"],
  evidenceKeys: ["method", "configured", "destinationCount"],
  evidenceVocabulary: { method: BACKUP_METHOD_VOCABULARY },
  explanation:
    "There is no backup set up for this Mac. If the disk fails, the Mac is stolen, or ransomware scrambles your files, everything that is not backed up is gone. Time Machine is built in and only needs an external disk or a network drive.",
  fix: {
    summary: "Add a backup disk in Time Machine.",
    settingsPath: ["System Settings", "General", "Time Machine"],
    settingsPane: "time_machine",
    commands: [],
    steps: [
      "Plug in an external disk, or make sure a network drive you can use for backups is reachable.",
      "Open System Settings, then General, then Time Machine, and click Add Backup Disk.",
      "Choose the disk and keep Back Up Automatically on. Encrypting the backup is recommended if the disk ever leaves the house.",
    ],
    verify: "Time Machine lists the disk and shows a time for the latest backup after the first run.",
    effort: "ten_minutes",
    sideEffects: "none",
    apply: {
      kind: "deep_link",
      pane: "time_machine",
      watch: ["backup"],
      watchEvery: 10,
      reveal: null,
    },
  },
  evaluate(state) {
    const data = section(state, "backup");
    const evidence = [
      ev.enum("method", "Backup method", data.method),
      ev.bool("configured", "Backup configured", data.configured),
      ev.number("destinationCount", "Backup destinations", data.destinationCount, "count"),
    ];
    return data.configured && data.destinationCount > 0 ? pass(evidence) : fail(evidence);
  },
};
