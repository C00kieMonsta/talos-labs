import type { ReactNode } from "react";

export function Lock({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="lock" role="region" aria-label={title}>
      <div className="lock-lines" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="lock-panel">
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <rect x="4" y="9" width="12" height="9" rx="2" fill="currentColor" />
          <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <div>
          <p className="lock-title">{title}</p>
          <p className="lock-body">{body}</p>
          {action}
        </div>
      </div>
    </div>
  );
}
