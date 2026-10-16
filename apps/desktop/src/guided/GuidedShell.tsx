import type { ReactNode } from "react";
import { Settings as GearIcon } from "lucide-react";
import { useApp } from "../app/context";
import { ICONS } from "../app/icons";
import { Icon } from "../components/Icon";
import type { ToolbarAction } from "../components/Toolbar";

/** The guided shell: no sidebar, a 52 px strip with the brand, "Details" and a gear, one centred column. */
export function GuidedShell({ title, actions = [], inactive, children }: { title?: string; actions?: readonly ToolbarAction[]; inactive: boolean; children: ReactNode }) {
  const { router } = useApp();
  return (
    <div className={inactive ? "shell guided-shell window-inactive" : "shell guided-shell"}>
      <header className="title-strip guided-strip" data-tauri-drag-region="true">
        <div className="guided-brand">
          <span className="sidebar-mark" aria-hidden="true">
            <Icon icon={ICONS.brand} size={16} className="sidebar-mark-icon" />
          </span>
          <span>Talos Labs</span>
        </div>
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
              <button type="button" className="button icon-button" title="Settings" onClick={() => router.navigate({ name: "settings" })}>
                <GearIcon size={16} aria-hidden="true" />
                <span className="visually-hidden">Settings</span>
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
