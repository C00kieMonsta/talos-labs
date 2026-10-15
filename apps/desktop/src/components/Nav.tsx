import type { RouteName } from "../app/router";

export interface NavItem {
  readonly name: RouteName;
  readonly label: string;
}

export function Nav({
  items,
  current,
  onSelect,
}: {
  items: readonly NavItem[];
  current: RouteName;
  onSelect(name: RouteName): void;
}) {
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-brand">Talos Labs</div>
      <ul>
        {items.map((item) => {
          const active = item.name === current;
          return (
            <li key={item.name}>
              <button
                type="button"
                className={active ? "nav-link active" : "nav-link"}
                aria-current={active ? "page" : undefined}
                onClick={() => onSelect(item.name)}
              >
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
