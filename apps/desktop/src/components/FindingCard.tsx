import type { Finding, RuleId } from "@talos/core";
import type { MouseEvent } from "react";
import { FIX_COST_ICONS, ICONS } from "../app/icons";
import type { FixCostKey } from "../app/icons";
import { CATEGORY_LABELS, UNKNOWN_REASON_LABELS } from "../app/labels";
import { Icon } from "./Icon";
import { SeverityBadge } from "./SeverityBadge";

export const FIX_COST_LABELS: Readonly<Record<FixCostKey, string>> = {
  in_app: "Fix in app",
  deep_link: "Open Settings",
  manual: "Steps",
};

export const FIX_ACTION_LABELS: Readonly<Record<FixCostKey, string>> = {
  in_app: "Fix now",
  deep_link: "Open Settings",
  manual: "See steps",
};

/**
 * An article whose headline link stretches over the card, so the whole card opens the finding without
 * nesting interactive elements. The optional action button sits above the link in z-order.
 */
export function FindingCard({
  finding,
  rank,
  reasonLabel,
  onOpen,
  onAction,
}: {
  finding: Finding;
  rank?: number;
  /** Replaces the generic reason label for an unknown finding. */
  reasonLabel?: string;
  onOpen(ruleId: RuleId): void;
  /** When given, the footer shows the action button for the fix kind. */
  onAction?(ruleId: RuleId): void;
}) {
  const kind = finding.fix.apply.kind;
  function open(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    onOpen(finding.ruleId);
  }
  return (
    <article className={`card finding-card finding-${finding.status}`} data-rule-id={finding.ruleId}>
      <div className="finding-card-head">
        <SeverityBadge severity={finding.severity} />
        <span className="finding-card-category">{CATEGORY_LABELS[finding.category]}</span>
        {rank !== undefined && (
          <span className="badge badge-rank">
            AI #{rank}
            <span className="visually-hidden">, AI suggestion, not verified</span>
          </span>
        )}
      </div>
      <a className="finding-card-title" href={`#finding/${finding.ruleId}`} onClick={open}>
        {finding.headline}
      </a>
      {finding.status === "fail" && finding.points > 0 && (
        <p className="finding-card-points">+{finding.points} points when fixed</p>
      )}
      {finding.status === "unknown" && finding.unknownReason !== null && (
        <p className="finding-card-reason">{reasonLabel ?? UNKNOWN_REASON_LABELS[finding.unknownReason]}</p>
      )}
      <div className="finding-card-foot">
        {onAction !== undefined && finding.status !== "unknown" && (
          <button type="button" className="button button-small finding-card-action" onClick={() => onAction(finding.ruleId)}>
            {FIX_ACTION_LABELS[kind]}
            <span className="visually-hidden">: {finding.headline}</span>
          </button>
        )}
        <span className="finding-card-cost">
          <Icon icon={FIX_COST_ICONS[kind]} />
          {FIX_COST_LABELS[kind]}
        </span>
      </div>
      <Icon icon={ICONS.chevronRight} className="finding-card-chevron" />
    </article>
  );
}

/** Three inset bars where a card will land. */
export function FindingCardSkeleton() {
  return (
    <div className="card finding-card finding-card-skeleton skeleton" role="status" aria-live="polite">
      <span className="skeleton-bar" aria-hidden="true" />
      <span className="skeleton-bar" aria-hidden="true" />
      <span className="skeleton-bar" aria-hidden="true" />
      <span className="visually-hidden">Loading</span>
    </div>
  );
}
