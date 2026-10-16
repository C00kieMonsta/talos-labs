/** Renders model output as plain text nodes. Never HTML, markdown or links. */
export function ModelText({ text, className, caret = false }: { text: string; className?: string; caret?: boolean }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const last = paragraphs.length - 1;
  return (
    <div className={className === undefined ? "model-text" : `model-text ${className}`}>
      {paragraphs.length === 0 && caret && (
        <p>
          <span className="caret" aria-hidden="true" />
        </p>
      )}
      {paragraphs.map((paragraph, index) => (
        <p key={index}>
          {paragraph}
          {caret && index === last && <span className="caret" aria-hidden="true" />}
        </p>
      ))}
    </div>
  );
}
