/** Placeholder bars while content loads. The shimmer stops under reduced motion (base.css). */
export function Skeleton({ bars = 3, label = "Loading", className }: { bars?: number; label?: string; className?: string }) {
  return (
    <div className={className === undefined ? "skeleton" : `skeleton ${className}`} role="status" aria-live="polite">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="skeleton-bar" aria-hidden="true" />
      ))}
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
