import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, hoursBetween, MACOS_ONLY, notApplicable, pass, section, unknown } from "../helpers";

export const BACKUP_MAX_AGE_HOURS = 168;

export const TL_MAC_027: Rule = {
  id: "TL-MAC-027",
  title: "A backup ran in the last 7 days",
  failTitle: "No backup has run in the last 7 days",
  severity: "low",
  category: "backup",
  cis: null,
  os: MACOS_ONLY,
  requires: ["backup"],
  evidenceKeys: ["hasBackup", "hoursSinceBackup", "destinationReachable"],
  evidenceVocabulary: {},
  explanation:
    "Backups are set up, but the most recent one is more than a week old, or none has completed yet. A backup only protects the work you had done when it ran, so a long gap means days of files, photos and settings that could be lost. Plugging the backup disk in and running a backup now closes that gap.",
  guided: {
    headline: "Your last backup is over a week old",
    why: "A backup only helps if it is recent.",
    verb: "Show me where",
    done: "Done. A fresh backup has run.",
    where: "Plug in your backup disk, then click \"Back Up Now\".",
  },
  fix: {
    summary: "Connect the backup disk and run a backup now.",
    settingsPath: ["System Settings", "General", "Time Machine"],
    settingsPane: "time_machine",
    commands: [
      {
        program: "tmutil",
        args: ["startbackup"],
        needsAdmin: false,
        interactive: false,
        appliesTo: null,
      },
    ],
    steps: [
      "Plug in the backup disk, or make sure the network drive is reachable.",
      "Click the Time Machine icon in the menu bar and choose Back Up Now. If the icon is hidden, turn it on under System Settings, then Control Centre.",
      "Leave the Mac on until the backup finishes.",
    ],
    verify: "Time Machine shows a latest backup time within the last week, and the check-up passes while the backup disk is connected.",
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
    if (!data.configured) {
      return notApplicable();
    }
    const evidence: Evidence[] = [ev.bool("hasBackup", "A backup exists", data.lastBackupAt !== null)];
    if (data.destinationReachable !== null) {
      evidence.push(ev.bool("destinationReachable", "Backup disk reachable", data.destinationReachable));
    }
    if (data.lastBackupAt === null) {
      // An unreachable disk hides the backup date, so no age was measured.
      return data.destinationReachable === false ? unknown("indeterminate", evidence) : fail(evidence);
    }
    const hours = hoursBetween(data.lastBackupAt, state.collectedAt);
    if (hours === null) {
      return unknown("indeterminate", evidence);
    }
    evidence.push(ev.number("hoursSinceBackup", "Hours since the last backup", Math.max(0, Math.floor(hours)), "hours"));
    return hours <= BACKUP_MAX_AGE_HOURS ? pass(evidence) : fail(evidence);
  },
};
