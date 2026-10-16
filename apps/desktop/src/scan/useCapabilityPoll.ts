import { useCallback, useEffect, useRef, useState } from "react";
import type { Capabilities, SectionKey } from "@talos/core";
import { awayPolling, type AwayPoller } from "./awayPolling";

export const CAPABILITY_POLL_MS = 2000;
export const GRANTED_FLASH_MS = 600;

export type PermissionKind = "full_disk_access" | "automation";

export type PermissionCardState =
  | "not_granted"
  | "not_determined"
  | "watching"
  | "granted"
  | "reopen_needed"
  | "prompting";

export interface PermissionFlowDeps {
  capabilities(): Promise<Capabilities>;
  openPane(kind: PermissionKind): Promise<void>;
  /** The free recheck of the sections the permission unlocks. */
  recheck(sections: readonly SectionKey[]): Promise<void>;
  /** For not_determined Automation: reading the section makes macOS ask. */
  collectSection(key: SectionKey): Promise<unknown>;
  restart(): Promise<void>;
}

const SECTIONS: Readonly<Record<PermissionKind, readonly SectionKey[]>> = {
  full_disk_access: ["browsers"],
  automation: ["loginItems"],
};

export const CONTINUE_KEY = "talos.continue";

function granted(kind: PermissionKind, caps: Capabilities): boolean {
  return kind === "full_disk_access" ? caps.fullDiskAccess === true : caps.automation === "granted";
}

export interface PermissionFlow {
  readonly state: PermissionCardState;
  open(): void;
  allow(): void;
  reopen(): void;
}

/** The card's watcher: open the pane, poll while away, recheck when granted, offer Reopen for a Full Disk Access grant that needs a relaunch. */
export function usePermissionFlow(kind: PermissionKind, initial: "not_granted" | "not_determined", deps: PermissionFlowDeps): PermissionFlow {
  const [state, setState] = useState<PermissionCardState>(initial);
  const poller = useRef<AwayPoller | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => () => poller.current?.stop(), []);

  const open = useCallback(() => {
    void depsRef.current.openPane(kind);
    setState("watching");
    poller.current?.stop();
    poller.current = awayPolling({
      everyMs: CAPABILITY_POLL_MS,
      poll: async () => {
        const caps = await depsRef.current.capabilities();
        if (!granted(kind, caps)) return "continue";
        setState("granted");
        setTimeout(() => void depsRef.current.recheck(SECTIONS[kind]), GRANTED_FLASH_MS);
        return "stop";
      },
      onPaused: () => {
        // Focus has been back for the grace period and the grant has not shown: the app needs a relaunch.
        if (kind === "full_disk_access") setState("reopen_needed");
      },
      onExpired: () => setState(initial),
    });
  }, [kind, initial]);

  const allow = useCallback(() => {
    setState("prompting");
    void depsRef.current.collectSection(SECTIONS[kind][0] as SectionKey).finally(() => {
      void depsRef.current.recheck(SECTIONS[kind]);
    });
  }, [kind]);

  const reopen = useCallback(() => {
    try {
      localStorage.setItem(CONTINUE_KEY, "fda");
    } catch {
      // No storage: the relaunch still happens, it just lands on the Overview.
    }
    void depsRef.current.restart();
  }, []);

  return { state, open, allow, reopen };
}
