import type { Finding, RuleId } from "@talos/core";
import { SeverityBadge } from "./SeverityBadge";
import { CATEGORY_LABELS, UNKNOWN_REASON_LABELS } from "../app/labels";

/** The whole card is the button, so its accessible name is its visible content: badge, category, headline, points. */
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
      data-rule-id={finding.ruleId}
      onClick={() => onOpen(finding.ruleId)}
    >
      <div className="finding-card-head">
        <SeverityBadge severity={finding.severity} />
        <span className="muted small">{CATEGORY_LABELS[finding.category]}</span>
        {rank !== undefined && (
          <span className="badge badge-rank">
            AI #{rank}
            <span className="visually-hidden">, AI suggestion, not verified</span>
          </span>
        )}
      </div>
      <span className="finding-card-title">{finding.headline}</span>
      {finding.status === "fail" && finding.points > 0 && (
        <p className="finding-card-points">+{finding.points} points when fixed</p>
      )}
      {finding.status === "unknown" && finding.unknownReason !== null && (
        <p className="muted small">{reasonLabel ?? UNKNOWN_REASON_LABELS[finding.unknownReason]}</p>
      )}
    </button>
  );
}
