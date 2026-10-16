import type { FixError } from "@talos/core";
import type { RecheckResult } from "../scan/machine";

export const PASSWORD_SENTENCE =
  "macOS will ask for your administrator password. The dialog is macOS's own and may name osascript. Talos Labs never sees the password.";
export const NO_PASSWORD_SENTENCE = "No password is needed.";
export const AFTERWARDS_SENTENCE = "Afterwards, Talos Labs reads this area again to confirm it worked.";
export const RESTART_SENTENCE = "Your Mac will need to restart for this to take effect.";

export type FixSheetAction = "try_again" | "close" | "open_settings" | "check_again" | "rescan" | "review";

export interface FixCopy {
  readonly text: string;
  readonly actions: readonly FixSheetAction[];
}

/** Error copy from the design table; the bracket only in Developer mode, Open System Settings only with a pane. */
export function fixErrorCopy(error: FixError, step: number | null, developer: boolean, hasPane: boolean): FixCopy {
  switch (error) {
    case "cancelled":
      return { text: "You closed the password dialog, so nothing was changed.", actions: ["try_again", "close"] };
    case "wrong_password":
      return { text: "macOS did not accept the password. Nothing was changed.", actions: ["try_again", "close"] };
    case "command_failed": {
      const bracket = developer && step !== null ? ` (step ${step} did not complete)` : "";
      const pane = hasPane ? " You can do this in System Settings instead." : "";
      return {
        text: `The command did not complete${bracket}. Nothing else was run.${pane}`,
        actions: hasPane ? ["open_settings", "close"] : ["close"],
      };
    }
    case "timeout":
      return { text: "macOS did not answer in time. Nothing further was run.", actions: ["try_again", "close"] };
    case "precondition_changed":
      return { text: "This setting changed since the check-up. Rescan to see where things stand.", actions: ["rescan"] };
    case "plan_expired":
      return { text: "This confirmation is more than five minutes old. Have another look.", actions: ["review"] };
    case "invalid_choice":
      return { text: "That item can't be changed from here.", actions: hasPane ? ["open_settings", "close"] : ["close"] };
    case "invalid_input":
      return {
        text: "The passphrase was not accepted. It needs 8 to 256 characters and no control characters.",
        actions: ["try_again", "close"],
      };
    case "not_in_catalog":
      return { text: "This fix can't be run from the app. Follow the steps instead.", actions: ["close"] };
    case "busy":
      return { text: "Another fix is still running.", actions: ["close"] };
  }
}

export function recheckCopy(result: Exclude<RecheckResult, "pass">, hasPane: boolean): FixCopy {
  if (result === "still_failing") {
    return {
      text: "The command ran, but the check still fails. macOS sometimes needs a moment. Check again in a minute, or use System Settings.",
      actions: hasPane ? ["check_again", "open_settings"] : ["check_again"],
    };
  }
  return { text: "The command ran, but this area could not be read back. The earlier result still stands.", actions: ["check_again"] };
}

export const ACTION_LABELS: Readonly<Record<FixSheetAction, string>> = {
  try_again: "Try again",
  close: "Close",
  open_settings: "Open System Settings",
  check_again: "Check again",
  rescan: "Rescan",
  review: "Review",
};

export function runningLabel(phase: "waiting_for_password" | "running" | "rechecking", step: number, of: number): string {
  if (phase === "waiting_for_password") return "Waiting for macOS to check your password";
  if (phase === "rechecking") return "Checking the result";
  return `Running (${step} of ${of})`;
}

export function doneLabel(ruleId: string, title: string, points: number): string {
  if (ruleId === "TL-MAC-029") return "Done. Your key is protected.";
  return points > 0 ? `Done. ${title}. +${points} points.` : `Done. ${title}.`;
}

export const SSH_ADD_NOTE =
  "If you use the key often, ssh-add --apple-use-keychain stores the passphrase in the Keychain. Talos Labs does not run it.";
