import type { CSSProperties } from "react";
import { SpiralMark } from "./icons/SpiralMark";

/** The site hero's horizon: two quadratic dunes in a 1400 x 170 box (brand/mineral/hero/horizon.svg). */
export const HORIZON_VIEWBOX = "0 0 1400 170";
export const HORIZON_BACK = "M0 130Q330 45 700 122T1400 95V170H0Z";
export const HORIZON_FRONT = "M0 160Q350 108 660 146T1400 120V170H0Z";

/** The site hero's rings: seven circles 32 units apart and a centre dot in a 670 box (brand/mineral/hero/rings.svg). */
export const RINGS_VIEWBOX = "0 0 670 670";
export const RINGS_CENTRE = { x: 334, y: 335 } as const;
export const RINGS_RADII: readonly number[] = [85, 117, 149, 181, 213, 245, 277];
export const RINGS_DOT_RADIUS = 3;

export type HeroKind = "spiral" | "rings" | "horizon";

interface HeroProps {
  readonly kind: HeroKind;
  /** Spiral and rings: the square band in px (default 560). */
  readonly size?: number;
  /** Horizon: the band height in px (default 120). */
  readonly height?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}

/**
 * Decorative hero bands (docs/DESIGN-WARMTH.md section 4). Never read by assistive tech, never take pointer events.
 * "spiral": the kit mark, large, offset top-right of its positioned parent (.content), at --hero-spiral-opacity.
 * "rings": the site hero's concentric circles, in the same place with the same stroke and opacity tokens.
 * "horizon": the site's dunes, full width, in flow at the bottom of the end screen.
 */
export function Hero({ kind, size = 560, height = 120, className, style }: HeroProps) {
  const classes = ["hero", `hero-${kind}`, className].filter(Boolean).join(" ");
  if (kind === "spiral") {
    return (
      <div className={classes} style={{ width: size, height: size, ...style }} aria-hidden="true" data-testid="hero-spiral">
        <SpiralMark size="100%" focusable="false" />
      </div>
    );
  }
  if (kind === "rings") {
    return (
      <div className={classes} style={{ width: size, height: size, ...style }} aria-hidden="true" data-testid="hero-rings">
        <svg viewBox={RINGS_VIEWBOX} focusable="false">
          <g fill="none" stroke="currentColor">
            {RINGS_RADII.map((r) => (
              <circle key={r} cx={RINGS_CENTRE.x} cy={RINGS_CENTRE.y} r={r} />
            ))}
          </g>
          <circle cx={RINGS_CENTRE.x} cy={RINGS_CENTRE.y} r={RINGS_DOT_RADIUS} fill="currentColor" />
        </svg>
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
