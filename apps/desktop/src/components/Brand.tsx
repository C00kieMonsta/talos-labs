import { SpiralMark } from "./icons";

/**
 * The spiral mark and the "Talos Labs" wordmark for the title strip and the sidebar brand row.
 * The mark takes --brand-mark (espresso in light, paper in dark) through currentColor.
 */
export function Brand({ size = 24, className }: { size?: 20 | 24; className?: string }) {
  return (
    <span className={className === undefined ? "brand" : `brand ${className}`}>
      <SpiralMark size={size} className="brand-mark" aria-hidden="true" focusable="false" />
      <span className="brand-name">Talos Labs</span>
    </span>
  );
}
