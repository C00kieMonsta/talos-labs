import type { ReactNode } from "react";
import { ICONS } from "../app/icons";
import { Icon } from "../components/Icon";

export type GuidedRowIcon = "none" | "pending" | "ok" | "failed" | "bullet";

export interface GuidedRow {
  readonly key: string;
  readonly text: ReactNode;
  readonly icon: GuidedRowIcon;
  /** A tag after the text, e.g. "I'll do this". */
  readonly tag?: string;
}

function RowIcon({ icon }: { icon: GuidedRowIcon }) {
  switch (icon) {
    case "ok":
      return <Icon icon={ICONS.check} size={20} className="guided-row-ok" />;
    case "failed":
      return <Icon icon={ICONS.close} size={20} className="guided-row-failed" />;
    case "pending":
      return <Icon icon={ICONS.spinner} size={20} className="spin" />;
    case "bullet":
      return (
        <span className="guided-bullet" aria-hidden="true">
          •
        </span>
      );
    case "none":
      return <span className="guided-icon-slot" aria-hidden="true" />;
  }
}

/** Rows at the guided list size with a 20 px icon slot. The state is always in the text too. */
export function GuidedList({ rows, label }: { rows: readonly GuidedRow[]; label?: string }) {
  return (
    <ul className="guided-list" role="list" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className={`guided-row guided-row-${row.icon}`}>
          <RowIcon icon={row.icon} />
          <span className="guided-row-text">{row.text}</span>
          {row.tag !== undefined && <span className="guided-tag">{row.tag}</span>}
        </li>
      ))}
    </ul>
  );
}
