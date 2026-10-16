import type { ReactNode } from "react";
import type { IconComponent } from "./KitIcon";
import { ICONS } from "../app/icons";
import { Icon } from "./Icon";

export interface ToolbarAction {
  readonly label: string;
  readonly icon: IconComponent;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  /** A spinner replaces the icon while true. */
  readonly busy?: boolean;
}

/**
 * The page head of an expert screen: h1 at 21/600 with its meta line, bordered text buttons at the right.
 * A div, not a header: the title strip above it is the one banner landmark.
 */
export function Toolbar({
  title,
  subtitle,
  back,
  actions = [],
  children,
}: {
  /** Omitted when the screen body owns the h1, as on a finding. */
  title?: string;
  subtitle?: string;
  /** Shown as "‹ Label" above the title. */
  back?: { label: string; onClick: () => void };
  actions?: readonly ToolbarAction[];
  children?: ReactNode;
}) {
  return (
    <div className={title === undefined ? "toolbar expert-head expert-head-bare" : "toolbar expert-head"}>
      <div className="expert-head-text">
        {back !== undefined && (
          <button type="button" className="subtle-button toolbar-back" onClick={back.onClick}>
            <span aria-hidden="true">‹ </span>
            <span>{back.label}</span>
          </button>
        )}
        {title !== undefined && <h1>{title}</h1>}
        {subtitle !== undefined && <p className="toolbar-subtitle">{subtitle}</p>}
      </div>
      <div className="toolbar-actions">
        {children}
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="toolbar-button"
            title={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
            aria-disabled={action.disabled}
          >
            <Icon icon={action.busy === true ? ICONS.spinner : action.icon} className={action.busy === true ? "spin" : undefined} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
