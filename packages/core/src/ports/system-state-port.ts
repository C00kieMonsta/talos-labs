import type { SectionKey, SystemState, SystemStateSections } from "../domain/system-state";

/** Structural subset of AbortSignal so core needs no DOM or Node lib. A real AbortSignal satisfies it. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface SectionProgress {
  readonly key: SectionKey;
  readonly status: "started" | "ok" | "unavailable";
}

export interface CollectOptions {
  readonly signal?: AbortSignalLike;
  readonly onProgress?: (progress: SectionProgress) => void;
}

/** Options for a single-section recheck. */
export interface CollectSectionOptions {
  readonly signal?: AbortSignalLike;
}

/** Automation permission for System Events, read without prompting. */
export type AutomationStatus = "granted" | "denied" | "not_determined";

export interface Capabilities {
  /** null when no probe directory exists on this machine. */
  readonly fullDiskAccess: boolean | null;
  /** null when the probe could not decide (System Events not running). */
  readonly automation: AutomationStatus | null;
}

/** Implemented by the desktop app over Tauri commands. Read-only. */
export interface SystemStatePort {
  collect(options?: CollectOptions): Promise<SystemState>;
  /** Re-collect one section for "I've done this, check again". */
  collectSection<K extends SectionKey>(
    key: K,
    options?: CollectSectionOptions,
  ): Promise<SystemStateSections[K]>;
  capabilities(): Promise<Capabilities>;
}
