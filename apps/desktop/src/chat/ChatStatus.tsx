/** The one live region of the chat, outside the log (docs/DESIGN-CHAT-UI.md "Anatomy", item 3). */
export function ChatStatus({ text, seq }: { text: string; seq: number }) {
  // The same sentence twice is still a change for the screen reader: a trailing space toggles with the sequence.
  const spoken = seq % 2 === 0 ? text : `${text} `;
  return (
    <div className="chat-status visually-hidden" role="status">
      {spoken}
    </div>
  );
}
