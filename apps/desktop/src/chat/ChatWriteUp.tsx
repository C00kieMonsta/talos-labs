import { useEffect, useState } from "react";
import { ACTIVITY } from "../guided/copy";

/** How long "Copied" stays beside the primary. */
export const COPIED_MS = 1500;

/**
 * The write-up card's preview and its one primary (docs/DESIGN-AGENT.md 2g): a pre that scrolls past eight lines, "Copy it",
 * and the word "Copied" for 1500 ms after a successful copy. No live region: the chat's one status element announces the copy.
 */
export function ChatWriteUp({ text, copiedAt, onCopy }: { text: string; copiedAt: number | null; onCopy: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (copiedAt === null) return;
    setCopied(true);
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copiedAt]);
  return (
    <>
      <pre className="chat-writeup">{text}</pre>
      <div className="chat-writeup-actions">
        <button type="button" className="button button-primary chat-card-primary" onClick={onCopy}>
          {ACTIVITY.writeUp.copy}
        </button>
        {copied && <span className="chat-writeup-copied">{ACTIVITY.writeUp.copied}</span>}
      </div>
    </>
  );
}
