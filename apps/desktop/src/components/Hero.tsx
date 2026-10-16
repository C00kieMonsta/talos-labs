import type { CSSProperties } from "react";
import { SpiralMark } from "./icons/SpiralMark";

/** The site hero's horizon: two quadratic dunes in a 1400 x 170 box (brand/mineral/hero/horizon.svg). */
export const HORIZON_VIEWBOX = "0 0 1400 170";
export const HORIZON_BACK = "M0 130Q330 45 700 122T1400 95V170H0Z";
export const HORIZON_FRONT = "M0 160Q350 108 660 146T1400 120V170H0Z";

export type HeroKind = "spiral" | "horizon";

interface HeroProps {
  readonly kind: HeroKind;
  /** Spiral: the square band in px (default 560). */
  readonly size?: number;
  /** Horizon: the band height in px (default 120). */
  readonly height?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * Decorative hero bands (docs/DESIGN-WARMTH.md section 2d). Never read by assistive tech, never take pointer events.
 * "spiral": the kit mark, large, offset top-right of its positioned parent (.content), at --hero-spiral-opacity.
 * "horizon": the site's dunes, full width, in flow at the bottom of the end screen.
 */
export function Hero({ kind, size = 560, height = 120, className, style }: HeroProps) {
  const classes = ["hero", kind === "spiral" ? "hero-spiral" : "hero-horizon", className].filter(Boolean).join(" ");
  if (kind === "spiral") {
    return (
      <div className={classes} style={{ width: size, height: size, ...style }} aria-hidden="true" data-testid="hero-spiral">
        <SpiralMark size="100%" focusable="false" />
      </div>
    );
  }
  return (
    <div className={classes} style={{ height, ...style }} aria-hidden="true" data-testid="hero-horizon">
      <svg viewBox={HORIZON_VIEWBOX} preserveAspectRatio="none" focusable="false">
        <path d={HORIZON_BACK} style={{ fill: "var(--horizon-1)" }} />
        <path d={HORIZON_FRONT} fillOpacity={0.5} style={{ fill: "var(--horizon-2)" }} />
      </svg>
    </div>
  );
}
