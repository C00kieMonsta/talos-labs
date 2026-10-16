import type { ReactNode } from "react";
import { ICONS } from "../app/icons";
import { Icon } from "./Icon";

/** A blurred placeholder with the lock panel over it. The panel carries the inline licence field. */
export function Lock({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card lock" role="region" aria-label={title}>
      <div className="lock-body skeleton" aria-hidden="true" style={{ minHeight: 190 }}>
        <div className="skeleton-bar" style={{ width: "70%", animation: "none" }} />
        <div className="skeleton-bar" style={{ width: "90%", animation: "none" }} />
        <div className="skeleton-bar" style={{ width: "55%", animation: "none" }} />
        <div className="skeleton-bar" style={{ width: "80%", animation: "none" }} />
        <div className="skeleton-bar" style={{ width: "40%", animation: "none" }} />
      </div>
      <div className="lock-panel">
        <Icon icon={ICONS.lock} size={20} />
        <p className="lock-title">{title}</p>
        <p className="lock-body-text lock-lines">{body}</p>
        {action}
      </div>
    </div>
  );
}
