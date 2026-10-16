import type { ReactNode } from "react";
import { ICONS } from "../app/icons";
import { Icon } from "./Icon";

/** A plain card: the lock icon, the title, one sentence and the inline licence field, in normal flow. */
export function Lock({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card lock" role="region" aria-label={title}>
      <div className="lock-panel">
        <Icon icon={ICONS.lock} size={20} />
        <p className="lock-title">{title}</p>
        <p className="lock-body-text lock-lines">{body}</p>
        {action}
      </div>
    </div>
  );
}
