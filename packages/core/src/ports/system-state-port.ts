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

export interface Capabilities {
  /** null when no probe directory exists on this machine. */
  readonly fullDiskAccess: boolean | null;
}

/** Implemented by the desktop app over Tauri commands. Read-only. */
export interface SystemStatePort {
  collect(options?: CollectOptions): Promise<SystemState>;
  /** Re-collect one section for "I've done this, check again". */
  collectSection<K extends SectionKey>(key: K): Promise<SystemStateSections[K]>;
  capabilities(): Promise<Capabilities>;
}
