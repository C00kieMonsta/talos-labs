import { useEffect, useRef, useState } from "react";

/**
 * Copies `text` to the clipboard. The accessible name always starts with the visible text
 * ("Copy command", then "Copied"), and a sibling status region announces the confirmation.
 */
export function CopyButton({ text, subject = "command" }: { text: string; subject?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button type="button" className="button button-small" onClick={copy} aria-label={copied ? "Copied" : `Copy ${subject}`}>
        {copied ? "Copied" : "Copy"}
      </button>
      <span role="status" className="visually-hidden">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}
