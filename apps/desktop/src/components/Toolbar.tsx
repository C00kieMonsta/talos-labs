import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ICONS } from "../app/icons";
import { Icon } from "./Icon";

export interface ToolbarAction {
  readonly label: string;
  readonly icon: LucideIcon;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  /** A spinner replaces the icon while true. */
  readonly busy?: boolean;
}

/** The 52 px strip at the top of the content column. The title is the screen's h1. */
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
  /** Shown as a chevron button on the left, before the title. */
  back?: { label: string; onClick: () => void };
  actions?: readonly ToolbarAction[];
  children?: ReactNode;
}) {
  return (
    <header className="toolbar title-strip" data-tauri-drag-region="true">
      {back !== undefined && (
        <button type="button" className="toolbar-back" onClick={back.onClick}>
          <Icon icon={ICONS.chevronLeft} />
          <span>{back.label}</span>
        </button>
      )}
      {title !== undefined && <h1>{title}</h1>}
      {subtitle !== undefined && <p className="toolbar-subtitle">{subtitle}</p>}
      <div className="toolbar-actions">
        {children}
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className="button icon-button"
            title={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
            aria-disabled={action.disabled}
          >
            <Icon icon={action.busy === true ? ICONS.spinner : action.icon} className={action.busy === true ? "spin" : undefined} />
            <span className="visually-hidden">{action.label}</span>
          </button>
        ))}
      </div>
    </header>
  );
}
