import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { ICONS } from "../app/icons";
import { Icon } from "./Icon";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * An in-window dialog over a scrim, anchored under the toolbar. Traps focus and closes on Escape or a
 * scrim click unless `locked` (a command is running). The caller keeps the sidebar inert.
 */
export function Sheet({
  title,
  onClose,
  locked = false,
  children,
  actions,
  className,
}: {
  title: string;
  onClose(): void;
  /** True while a command runs: Escape, the scrim and the close button do nothing. */
  locked?: boolean;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Move focus in on open and give it back on close.
  useEffect(() => {
    const opener = document.activeElement;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (lockedRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || panel.current === null) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panel.current.focus();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !locked) onClose();
      }}
    >
      <div
        ref={panel}
        className={className === undefined ? "sheet" : `sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="button icon-button"
            title="Close"
            onClick={onClose}
            disabled={locked}
            aria-disabled={locked}
          >
            <Icon icon={ICONS.close} />
            <span className="visually-hidden">Close</span>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {actions !== undefined && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>
  );
}
