import type { Finding, RuleId } from "@talos/core";
import { SeverityBadge } from "./SeverityBadge";
import { CATEGORY_LABELS, UNKNOWN_REASON_LABELS } from "../app/labels";

export function FindingCard({
  finding,
  rank,
  reasonLabel,
  onOpen,
}: {
  finding: Finding;
  rank?: number;
  /** Replaces the generic reason label for an unknown finding. */
  reasonLabel?: string;
  onOpen(ruleId: RuleId): void;
}) {
  return (
    <button
      type="button"
      className={`card finding-card finding-${finding.status}`}
      onClick={() => onOpen(finding.ruleId)}
      aria-label={`${finding.title}. Open details`}
    >
      <div className="finding-card-head">
        <SeverityBadge severity={finding.severity} />
        <span className="muted small">{CATEGORY_LABELS[finding.category]}</span>
        {rank !== undefined && (
          <span className="badge badge-rank" title="Suggested order from the AI, not verified">
            AI #{rank}
          </span>
        )}
      </div>
      <h3 className="finding-card-title">{finding.title}</h3>
      {finding.status === "fail" && finding.points > 0 && (
        <p className="finding-card-points">+{finding.points} points when fixed</p>
      )}
      {finding.status === "unknown" && finding.unknownReason !== null && (
        <p className="muted small">{reasonLabel ?? UNKNOWN_REASON_LABELS[finding.unknownReason]}</p>
      )}
    </button>
  );
}
