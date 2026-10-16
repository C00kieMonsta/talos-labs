import type { PermissionCardState } from "../scan/useCapabilityPoll";
import type { Core } from "./core";
import { setStep } from "./core";
import { PERMISSION } from "./copy";
import { writeContinue } from "./continue";

/** "Show me where": the continue note goes first, because System Settings may relaunch the app on its own. */
export function startPermission(core: Core, open: () => void): void {
  writeContinue({ kind: "guided" });
  open();
  setStep(core, { kind: "permission", card: "watching" });
}

/** "Quit and reopen": the guide resumes at the first undone step after the relaunch. */
export function reopenForPermission(core: Core): void {
  writeContinue({ kind: "guided" });
  void core.deps.restart();
}

/** Mirrors the permission flow into the step state. */
export function observePermission(core: Core, card: PermissionCardState): void {
  const { phase } = core;
  if (phase.kind !== "step") return;
  const state = phase.state;
  if (state.kind !== "permission" && state.kind !== "idle") return;
  if (card === "granted") {
    setStep(core, { kind: "done", line: PERMISSION.granted, rows: [] });
    return;
  }
  if (state.kind === "permission" && state.card !== card && (card === "watching" || card === "reopen_needed" || card === "not_granted")) {
    setStep(core, card === "not_granted" ? { kind: "idle" } : { kind: "permission", card });
  }
}
