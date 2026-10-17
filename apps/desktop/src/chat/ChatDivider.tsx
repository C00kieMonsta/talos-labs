import { formatTime } from "../app/labels";

/** One centred time between two hairlines when more than ten minutes passed (DIVIDER_GAP_MS). */
export function ChatDivider({ at }: { at: number }) {
  return (
    <div className="chat-divider" aria-hidden="true">
      <span>{formatTime(new Date(at).toISOString())}</span>
    </div>
  );
}
