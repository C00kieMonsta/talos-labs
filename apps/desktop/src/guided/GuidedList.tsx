import type { ReactNode } from "react";
import { ICONS } from "../app/icons";
import { Icon } from "../components/Icon";

export type GuidedRowIcon = "none" | "pending" | "ok" | "failed" | "bullet";

export interface GuidedRow {
  readonly key: string;
  readonly text: ReactNode;
  readonly icon: GuidedRowIcon;
  /** A line under the text, e.g. "I'll do this". */
  readonly tag?: string;
}

/** The 17 px circle bullet. Done rows draw the kit tick in success; failed rows the cross in secondary. */
function Bullet({ state }: { state: "empty" | "done" | "failed" }) {
  const Glyph = state === "done" ? ICONS.check : state === "failed" ? ICONS.close : null;
  const className = state === "done" ? "guided-bullet guided-bullet-done" : state === "failed" ? "guided-bullet guided-bullet-failed" : "guided-bullet";
  return (
    <span className={className} aria-hidden="true">
      {Glyph !== null && <Glyph size={11} strokeWidth={2.5} aria-hidden="true" focusable="false" />}
    </span>
  );
}

function RowIcon({ icon }: { icon: GuidedRowIcon }) {
  switch (icon) {
    case "ok":
      return <Bullet state="done" />;
    case "failed":
      return <Bullet state="failed" />;
    case "pending":
      return <Icon icon={ICONS.spinner} size={16} className="spin" />;
    case "bullet":
      return <Bullet state="empty" />;
    case "none":
      return <span className="guided-icon-slot" aria-hidden="true" />;
  }
}

/** Rows at the guided list size with hairlines between them. The state is always in the text too. */
export function GuidedList({ rows, label }: { rows: readonly GuidedRow[]; label?: string }) {
  return (
    <ul className="guided-list" role="list" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className={`guided-row guided-row-${row.icon}`}>
          <RowIcon icon={row.icon} />
          <span className="guided-row-text">
            {row.text}
            {row.tag !== undefined && <span className="guided-tag">{row.tag}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
