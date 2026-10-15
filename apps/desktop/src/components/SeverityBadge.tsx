import type { Severity } from "@talos/core";
import { SEVERITY_LABELS } from "../app/labels";

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge badge-${severity}`}>{SEVERITY_LABELS[severity]}</span>;
}
