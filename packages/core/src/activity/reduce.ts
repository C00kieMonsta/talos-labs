import type { ActivityEvent } from "./types";

/** Ordered by first sight, one entry per id. */
export interface ActivityState {
  readonly events: readonly ActivityEvent[];
}

export const EMPTY_ACTIVITY: ActivityState = { events: [] };

function sameEvent(a: ActivityEvent, b: ActivityEvent): boolean {
  return (
    a.cardId === b.cardId &&
    a.kind === b.kind &&
    a.status === b.status &&
    a.endedAt === b.endedAt &&
    a.ruleId === b.ruleId &&
    a.count === b.count &&
    a.step === b.step &&
    a.of === b.of &&
    a.probeId === b.probeId &&
    a.sectionKey === b.sectionKey &&
    a.outcome === b.outcome &&
    a.modelLine === b.modelLine
  );
}

/** Upsert by id. A known row keeps its place and its original `at`; a new id appends. The same state comes back when nothing changed. */
export function reduceActivity(state: ActivityState, event: ActivityEvent): ActivityState {
  const index = state.events.findIndex((e) => e.id === event.id);
  if (index === -1) return { events: [...state.events, event] };
  const existing = state.events[index];
  if (existing === undefined) return state;
  // A row that did not change status keeps its end time, so a repeated event is a no-op.
  const next: ActivityEvent = { ...event, at: existing.at, endedAt: existing.status === event.status ? existing.endedAt : event.endedAt };
  if (sameEvent(existing, next)) return state;
  const events = state.events.slice();
  events[index] = next;
  return { events };
}

/** The card's rows, oldest first. */
export function rowsFor(state: ActivityState, cardId: string): readonly ActivityEvent[] {
  return state.events.filter((e) => e.cardId === cardId);
}

/** The card's running row, for the announcer. */
export function runningFor(state: ActivityState, cardId: string): ActivityEvent | null {
  return state.events.find((e) => e.cardId === cardId && e.status === "running") ?? null;
}
