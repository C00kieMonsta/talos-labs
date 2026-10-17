import { useEffect, useRef, useState } from "react";
import type { ActivityEvent, ActivityState } from "@talos/core";
import { EMPTY_ACTIVITY, reduceActivity, rowsFor } from "@talos/core";
import type { FixingState } from "../scan/machine";
import { fixEvents } from "./fixActivity";

// The chat's useActivity (watch rows, section rows) joins this module with AGENT part B.

/**
 * The fix rows for one card, folded from the scan machine's fixing state.
 * Rows clear on a new card and on a new tap (a rising edge of `preparing`); they stay once the fix settles.
 */
export function useFixActivity(cardId: string, fixing: FixingState | null, preparing: boolean, now: () => number = Date.now): readonly ActivityEvent[] {
  const [state, setState] = useState<ActivityState>(EMPTY_ACTIVITY);
  const lastCard = useRef(cardId);
  const lastPreparing = useRef(false);
  useEffect(() => {
    const reset = lastCard.current !== cardId || (preparing && !lastPreparing.current);
    lastCard.current = cardId;
    lastPreparing.current = preparing;
    const events = fixEvents({ cardId, fixing, preparing, now: now() });
    setState((prev) => {
      let next = reset ? EMPTY_ACTIVITY : prev;
      for (const event of events) next = reduceActivity(next, event);
      return next;
    });
  }, [cardId, fixing, preparing, now]);
  return rowsFor(state, cardId);
}
