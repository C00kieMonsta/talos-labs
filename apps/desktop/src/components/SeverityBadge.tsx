import type { Severity } from "@talos/core";
import { SEVERITY_ICONS } from "../app/icons";
import { SEVERITY_LABELS } from "../app/labels";
import { Icon } from "./Icon";

/** A severity word with its icon, so colour never carries the meaning alone. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span className={`badge badge-${severity}`}>
      <Icon icon={SEVERITY_ICONS[severity]} />
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
