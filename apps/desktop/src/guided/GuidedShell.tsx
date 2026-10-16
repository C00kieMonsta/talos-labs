import type { ReactNode } from "react";
import { useApp } from "../app/context";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icon";
import type { ToolbarAction } from "../components/Toolbar";

/** The guided shell: no sidebar, a 52 px strip with the brand, "Details" and "Settings", one centred column. */
export function GuidedShell({ title, actions = [], inactive, children }: { title?: string; actions?: readonly ToolbarAction[]; inactive: boolean; children: ReactNode }) {
  const { router } = useApp();
  return (
    <div className={inactive ? "shell guided-shell window-inactive" : "shell guided-shell"}>
      <header className="title-strip guided-strip" data-tauri-drag-region="true">
        <Brand size={24} className="guided-brand" />
        {title !== undefined && <h1 className="guided-strip-title">{title}</h1>}
        <div className="guided-strip-actions">
          {actions.map((action) => (
            <button key={action.label} type="button" className="button icon-button" title={action.label} onClick={action.onClick} disabled={action.disabled} aria-disabled={action.disabled}>
              <Icon icon={action.icon} />
              <span className="visually-hidden">{action.label}</span>
            </button>
          ))}
          {actions.length === 0 && (
            <>
              <button type="button" className="guided-strip-link" onClick={() => router.navigate({ name: "overview" })}>
                Details
              </button>
              <button type="button" className="guided-strip-link" onClick={() => router.navigate({ name: "settings" })}>
                Settings
              </button>
            </>
          )}
        </div>
      </header>
      <div className="content guided-content">
        <div className="guided">{children}</div>
      </div>
    </div>
  );
}
