import { formatTime } from "../app/labels";

/** One centred time between two hairlines when more than ten minutes passed (DIVIDER_GAP_MS); the time is content, so it is read. */
export function ChatDivider({ at }: { at: number }) {
  return (
    <div className="chat-divider">
      <span>
        <span className="visually-hidden">At </span>
        {formatTime(new Date(at).toISOString())}
      </span>
    </div>
  );
}
