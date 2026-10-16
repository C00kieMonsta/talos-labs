import type { AutomationStatus, Capabilities } from "../ports/system-state-port";

/** Hand-written structural check for the check_capabilities answer. Each field is read on its own, so a bad value in one does not hide the others. */

export const AUTOMATION_STATUSES: readonly AutomationStatus[] = ["granted", "denied", "not_determined"];

/** Unknown fields fall back to "could not tell"; a missing `bundled` counts as bundled so the dev-build hint never shows by accident. */
export function toCapabilities(value: unknown): Capabilities {
  if (typeof value !== "object" || value === null) return { fullDiskAccess: null, automation: null, bundled: true };
  const { fullDiskAccess, automation, bundled } = value as { fullDiskAccess?: unknown; automation?: unknown; bundled?: unknown };
  return {
    fullDiskAccess: typeof fullDiskAccess === "boolean" ? fullDiskAccess : null,
    automation:
      typeof automation === "string" && (AUTOMATION_STATUSES as readonly string[]).includes(automation)
        ? (automation as AutomationStatus)
        : null,
    bundled: typeof bundled === "boolean" ? bundled : true,
  };
}
