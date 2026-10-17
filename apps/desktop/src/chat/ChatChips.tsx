import type { Chip } from "./chips";
import type { ChipId } from "./state";

/** One wrapping row of at most four chips; every chip is a real button and echoes as the person's bubble. */
export function ChatChips({ chips, onChip }: { chips: readonly Chip[]; onChip(id: ChipId): void }) {
  if (chips.length === 0) return null;
  return (
    <div className="chat-chips">
      {chips.map((chip) => (
        <button key={chip.id} type="button" className="chat-chip" onClick={() => onChip(chip.id)}>
          {chip.label}
        </button>
      ))}
    </div>
  );
}
