import type { Finding, RuleId } from "@talos/core";
import type { MouseEvent } from "react";
import { FIX_COST_ICONS, ICONS, SEVERITY_ICONS } from "../app/icons";
import type { FixCostKey } from "../app/icons";
import { UNKNOWN_REASON_LABELS } from "../app/labels";
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
 * A finding row: the 27 px severity mark, the headline over its points or reason line (with the action
 * button when there is one), the severity tag at the right, a chevron at the end. The headline link
 * stretches over the row, so the whole row opens the finding without nesting interactive elements; the
 * action sits above it in z-order.
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
  /** When given, the trail shows the action button for the fix kind. */
  onAction?(ruleId: RuleId): void;
}) {
  const kind = finding.fix.apply.kind;
  // The action button says how the fix is applied, so the cost word only shows without one.
  const showAction = onAction !== undefined && finding.status !== "unknown";
  function open(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    onOpen(finding.ruleId);
  }
  return (
    <article className={`finding-row finding-card finding-${finding.status}`} data-rule-id={finding.ruleId}>
      <span className={`finding-mark finding-mark-${finding.severity}`} aria-hidden="true">
        <Icon icon={SEVERITY_ICONS[finding.severity]} />
      </span>
      <div className="finding-row-content">
        <a className="finding-card-title" href={`#finding/${finding.ruleId}`} onClick={open}>
          {finding.headline}
        </a>
        <div className="finding-row-meta">
          {finding.status === "fail" && finding.points > 0 && (
            <p className="finding-card-points">+{finding.points} points when fixed</p>
          )}
          {finding.status === "unknown" && finding.unknownReason !== null && (
            <p className="finding-card-reason">{reasonLabel ?? UNKNOWN_REASON_LABELS[finding.unknownReason]}</p>
          )}
          {!showAction && (
            <span className="finding-card-cost">
              <Icon icon={FIX_COST_ICONS[kind]} />
              {FIX_COST_LABELS[kind]}
            </span>
          )}
          {showAction && (
            <button type="button" className="toolbar-button finding-card-action" onClick={() => onAction(finding.ruleId)}>
              <Icon icon={FIX_COST_ICONS[kind]} />
              {FIX_ACTION_LABELS[kind]}
              <span className="visually-hidden">: {finding.headline}</span>
            </button>
          )}
        </div>
      </div>
      <div className="finding-row-trail">
        {rank !== undefined && (
          <span className="badge badge-rank">
            AI #{rank}
            <span className="visually-hidden">, AI suggestion, not verified</span>
          </span>
        )}
        <SeverityBadge severity={finding.severity} />
      </div>
      <Icon icon={ICONS.chevronRight} className="finding-card-chevron" />
    </article>
  );
}

/** Three inset bars where a row will land. */
export function FindingCardSkeleton() {
  return (
    <div className="finding-row finding-card finding-card-skeleton skeleton" role="status" aria-live="polite">
      <span className="skeleton-bar" aria-hidden="true" />
      <span className="skeleton-bar" aria-hidden="true" />
      <span className="skeleton-bar" aria-hidden="true" />
      <span className="visually-hidden">Loading</span>
    </div>
  );
}
