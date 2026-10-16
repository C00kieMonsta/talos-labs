/**
 * SVG gradient definitions for the score ring and the done mark (docs/DESIGN-WARMTH.md section 2).
 * Mount once at the app root. Stops read the tokens through CSS, so light and dark follow the scheme.
 */
export const RING_GRADIENT_ID = "talos-ring-gradient";
export const MARK_GRADIENT_ID = "talos-mark-gradient";

/** `url(#...)` strings for fill and stroke attributes. */
export const RING_GRADIENT_FILL = `url(#${RING_GRADIENT_ID})`;
export const MARK_GRADIENT_FILL = `url(#${MARK_GRADIENT_ID})`;

export function GradientDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        {/* Along the arc's pre-rotation x axis: after the ring's rotate(-90) it runs from 12 o'clock (start) to 6 o'clock (end). */}
        <linearGradient id={RING_GRADIENT_ID} x1="1" y1="0.5" x2="0" y2="0.5">
          <stop offset="0" style={{ stopColor: "var(--gradient-ring-start)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--gradient-ring-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--gradient-ring-end)" }} />
        </linearGradient>
        {/* The accent gradient at 135deg for the 56 px done disc. */}
        <linearGradient id={MARK_GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--gradient-accent-start)" }} />
          <stop offset="1" style={{ stopColor: "var(--gradient-accent-end)" }} />
        </linearGradient>
      </defs>
    </svg>
  );
}
