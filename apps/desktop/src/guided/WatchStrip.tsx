/** The status line under an opened page: the rust dot and "I'll notice when it changes." */
export function WatchStrip({ text }: { text: string }) {
  return (
    <p className="guided-status guided-watch" role="status">
      <span className="scan-dot scan-dot-active" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
