import type { SettingsPane } from "@talos/core";
import { PERMISSION_COPY } from "../app/labels";

type Permission = "full_disk_access" | "automation";

export function PermissionCard({
  pane,
  affected,
  onOpen,
}: {
  pane: Permission;
  affected: readonly string[];
  onOpen(pane: SettingsPane): void;
}) {
  const copy = PERMISSION_COPY[pane];
  return (
    <section className="card card-muted permission" aria-labelledby={`perm-${pane}`}>
      <h3 id={`perm-${pane}`}>{copy.title}</h3>
      <p>{copy.body}</p>
      {affected.length > 0 && (
        <p className="muted">
          Affects: {affected.join(", ")}
        </p>
      )}
      <button type="button" className="button" onClick={() => onOpen(pane)} aria-label={`Open ${copy.title} settings`}>
        Open
      </button>
    </section>
  );
}
