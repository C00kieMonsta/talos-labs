import type { Capabilities, SettingsPane } from "@talos/core";
import { ICONS } from "../app/icons";
import { Icon } from "./Icon";
import { useApp } from "../app/context";
import { usePermissionFlow, type PermissionCardState, type PermissionKind } from "../scan/useCapabilityPoll";

export const PERMISSION_CARD_COPY: Readonly<Record<PermissionKind, { title: string; body: string; open: string }>> = {
  full_disk_access: {
    title: "Full Disk Access",
    body: "Talos Labs needs Full Disk Access to read the extension folders of Chrome, Brave, Edge, Arc and Firefox. Nothing else is read.",
    open: "Open Full Disk Access",
  },
  automation: {
    title: "Automation",
    body: "Talos Labs needs permission to ask System Events for your login items. Nothing else is read.",
    open: "Open Automation settings",
  },
};

export const PROMPTING_COPY = "macOS is asking whether Talos Labs may read your login items";
export const WATCHING_COPY = "Waiting for the switch in System Settings";
export const GRANTED_COPY = "Granted";
export const REOPEN_COPY = "macOS applies this once Talos Labs is reopened.";

/** The presentational card with its watcher states. */
export function PermissionCardView({
  kind,
  state,
  affected,
  onOpen,
  onAllow,
  onReopen,
}: {
  kind: PermissionKind;
  state: PermissionCardState;
  affected: readonly string[];
  onOpen(): void;
  onAllow(): void;
  onReopen(): void;
}) {
  const copy = PERMISSION_CARD_COPY[kind];
  const id = `perm-${kind}`;
  const line = (): { icon: keyof typeof ICONS; text: string; spin?: boolean } => {
    switch (state) {
      case "watching":
        return { icon: "spinner", text: WATCHING_COPY, spin: true };
      case "granted":
        return { icon: "check", text: GRANTED_COPY };
      case "reopen_needed":
        return { icon: "info", text: REOPEN_COPY };
      case "prompting":
        return { icon: "spinner", text: PROMPTING_COPY, spin: true };
      case "not_granted":
      case "not_determined":
        return { icon: "lock", text: copy.body };
    }
  };
  const { icon, text, spin } = line();
  return (
    <section className={`card card-muted permission permission-${state}`} aria-labelledby={id} data-permission-state={state}>
      <Icon icon={ICONS[icon]} size={20} className={spin === true ? "spin" : undefined} />
      <h3 id={id}>{copy.title}</h3>
      <p role={state === "watching" || state === "prompting" || state === "granted" ? "status" : undefined}>{text}</p>
      {affected.length > 0 && state !== "granted" && <p className="muted small">Affects: {affected.join(", ")}</p>}
      {(state === "not_granted" || state === "watching") && (
        <button type="button" className="button" onClick={onOpen} aria-disabled={state === "watching"}>
          {copy.open}
        </button>
      )}
      {state === "not_determined" && (
        <button type="button" className="button" onClick={onAllow}>
          Allow
        </button>
      )}
      {state === "reopen_needed" && (
        <button type="button" className="button button-primary" onClick={onReopen}>
          Reopen
        </button>
      )}
    </section>
  );
}

/** Initial state from the capabilities probe; the collector decides when the probe says nothing. */
export function initialPermissionState(kind: PermissionKind, capabilities: Capabilities | null): "not_granted" | "not_determined" {
  if (kind === "automation" && capabilities?.automation === "not_determined") return "not_determined";
  return "not_granted";
}

/** The card wired to the app: opens the pane, polls while away, rechecks when granted. */
export function PermissionCard({ kind, affected, capabilities }: { kind: PermissionKind; affected: readonly string[]; capabilities: Capabilities | null }) {
  const { adapters, scan } = useApp();
  const flow = usePermissionFlow(kind, initialPermissionState(kind, capabilities), {
    capabilities: () => adapters.systemState.capabilities(),
    openPane: (pane: SettingsPane) => adapters.openSettingsPane(pane),
    recheck: (sections) => scan.recheck(sections),
    collectSection: (key) => adapters.systemState.collectSection(key),
    restart: () => adapters.restart(),
  });
  return <PermissionCardView kind={kind} state={flow.state} affected={affected} onOpen={flow.open} onAllow={flow.allow} onReopen={flow.reopen} />;
}
