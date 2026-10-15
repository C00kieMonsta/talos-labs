import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const TL_MAC_001: Rule = {
  id: "TL-MAC-001",
  title: "Your disk is encrypted",
  failTitle: "Your disk is not encrypted",
  severity: "critical",
  category: "encryption",
  cis: "2.6.6",
  os: MACOS_ONLY,
  requires: ["diskEncryption"],
  evidenceKeys: ["systemVolumeEncrypted", "method"],
  evidenceVocabulary: { method: ["filevault", "bitlocker", "luks", "none", "unknown"] },
  explanation:
    "FileVault scrambles everything on your disk so it can only be read with your password. Without it, anyone who takes the Mac, or just its drive, can read your files by plugging it into another computer. It is the single most important setting on a laptop that ever leaves the house.",
  fix: {
    summary: "Turn on FileVault in System Settings and keep the recovery key somewhere safe.",
    settingsPath: ["System Settings", "Privacy & Security", "FileVault"],
    settingsPane: "filevault",
    commands: [],
    steps: [
      "Open System Settings, then Privacy & Security, and scroll to FileVault.",
      "Click Turn On and enter your password when asked.",
      "Choose how to keep the recovery key. Writing it down and storing it away from the Mac is the simplest option.",
      "Leave the Mac plugged in; encryption finishes in the background and may ask for a restart.",
    ],
    verify: "Privacy & Security > FileVault shows FileVault as on. Run the check-up again; this check passes.",
    effort: "ten_minutes",
    sideEffects: "restart",
  },
  evaluate(state) {
    const data = section(state, "diskEncryption");
    const evidence = [ev.bool("systemVolumeEncrypted", "System disk encrypted", data.systemVolumeEncrypted)];
    if (!data.systemVolumeEncrypted) {
      return fail(evidence);
    }
    // The method row only makes sense once the disk is encrypted.
    return pass([...evidence, ev.enum("method", "Encryption method", data.method)]);
  },
};
