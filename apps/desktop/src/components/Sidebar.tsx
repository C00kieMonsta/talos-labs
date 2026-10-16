import type { LicenseState } from "@talos/core";
import { ICONS, NAV_ICONS } from "../app/icons";
import type { NavKey } from "../app/icons";
import { Icon } from "./Icon";

/** "checkup" is the guided home; it has no NavKey because the expert routes own that type. */
export type SidebarKey = NavKey | "checkup";

export interface NavItem {
  readonly name: Exclude<SidebarKey, "settings">;
  readonly label: string;
}

/**
 * The left column. Paints nothing so the window material shows through. The title strip at the top
 * is a drag region that leaves room for the traffic lights.
 */
export function Sidebar({
  items,
  current,
  license,
  dimmed = false,
  onSelect,
}: {
  items: readonly NavItem[];
  current: SidebarKey;
  license: LicenseState;
  /** True while a scan runs: 50 % opacity and inert. */
  dimmed?: boolean;
  onSelect(name: SidebarKey): void;
}) {
  const licensed = license.status === "valid";
  return (
    <aside className={dimmed ? "sidebar sidebar-dimmed" : "sidebar"} inert={dimmed || undefined}>
      <div className="title-strip" data-tauri-drag-region="true" />
      <div className="sidebar-brand">
        <span className="sidebar-mark" aria-hidden="true">
          <Icon icon={ICONS.brand} size={16} className="sidebar-mark-icon" />
        </span>
        <span>Talos Labs</span>
      </div>
      <nav className="sidebar-nav" aria-label="Main">
        <ul>
          {items.map((item) => (
            <li key={item.name}>
              <NavRow name={item.name} label={item.label} active={item.name === current} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="sidebar-foot">
        <ul>
          <li>
            <NavRow name="settings" label="Settings" active={current === "settings"} onSelect={onSelect} />
          </li>
        </ul>
        <button
          type="button"
          className={licensed ? "pill pill-accent licence-pill" : "pill licence-pill"}
          onClick={() => onSelect("settings")}
          title="Licence settings"
        >
          {licensed ? "Licensed" : "Free"}
          <span className="visually-hidden">, open licence settings</span>
        </button>
      </div>
    </aside>
  );
}

function NavRow({
  name,
  label,
  active,
  onSelect,
}: {
  name: SidebarKey;
  label: string;
  active: boolean;
  onSelect(name: SidebarKey): void;
}) {
  return (
    <button
      type="button"
      className={active ? "nav-row active" : "nav-row"}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(name)}
    >
      <Icon icon={name === "checkup" ? ICONS.brand : NAV_ICONS[name]} />
      <span>{label}</span>
    </button>
  );
}
