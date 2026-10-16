import type { LucideIcon } from "lucide-react";
import type { IconComponent } from "./KitIcon";

export type { IconComponent };

/** One icon, kit or lucide, at the two sizes the design allows. Decorative unless a label is given. */
export function Icon({
  icon: Glyph,
  size = 16,
  label,
  className,
}: {
  icon: IconComponent | LucideIcon;
  size?: 16 | 20;
  /** Accessible name; omit for a decorative icon. */
  label?: string;
  className?: string;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.5}
      className={className}
      aria-hidden={label === undefined ? true : undefined}
      aria-label={label}
      role={label === undefined ? undefined : "img"}
      focusable="false"
    />
  );
}
