import type { Severity } from "@talos/core";
import { SEVERITY_ICONS } from "../app/icons";
import { SEVERITY_LABELS } from "../app/labels";
import { Icon } from "./Icon";

/** A severity word with its icon, so colour never carries the meaning alone. Rows pass icon={false}: their mark already shows it. */
export function SeverityBadge({ severity, icon = true }: { severity: Severity; icon?: boolean }) {
  return (
    <span className={icon ? `badge badge-${severity}` : `badge row-tag badge-${severity}`}>
      {icon && <Icon icon={SEVERITY_ICONS[severity]} />}
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
