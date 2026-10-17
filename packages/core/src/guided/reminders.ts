import type { RemindWhen } from "../chat/intents";
import type { RuleId } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { GuidedMemory } from "./memory";
import type { GuidedStep } from "./plan";

/** Local hour a reminder comes due. */
export const REMINDER_HOUR = 9;

/** 09:00 local tomorrow, or the next Sunday; on a Sunday, seven days. ISO. */
export function reminderDate(now: string, when: RemindWhen): string {
  const date = new Date(now);
  const days = when === "tomorrow" ? 1 : (7 - date.getDay()) % 7 || 7;
  date.setDate(date.getDate() + days);
  date.setHours(REMINDER_HOUR, 0, 0, 0);
  return date.toISOString();
}

/** snoozed[id] and reminders[id] = until for each id; laterCount is never touched. Same object for an empty list. */
export function remindRules(memory: GuidedMemory, ruleIds: readonly RuleId[], until: string): GuidedMemory {
  if (ruleIds.length === 0) return memory;
  const snoozed: Record<string, string> = { ...memory.snoozed };
  const reminders: Record<string, string> = { ...memory.reminders };
  for (const id of ruleIds) {
    snoozed[id] = until;
    reminders[id] = until;
  }
  return { ...memory, snoozed, reminders };
}

/** Ids whose reminder date has passed and whose finding still fails, in report order. */
export function reminderDue(memory: Pick<GuidedMemory, "reminders">, report: ScanReport, now: string): readonly RuleId[] {
  const at = Date.parse(now);
  if (Number.isNaN(at)) return [];
  const out: RuleId[] = [];
  for (const result of report.results) {
    const due = memory.reminders[result.ruleId];
    if (due === undefined || result.status !== "fail") continue;
    const dueAt = Date.parse(due);
    if (!Number.isNaN(dueAt) && dueAt <= at) out.push(result.ruleId);
  }
  return out;
}

/** Removes reminders[id] for each id. Same object when none is present. */
export function clearReminders(memory: GuidedMemory, ruleIds: readonly RuleId[]): GuidedMemory {
  const ids = new Set<string>(ruleIds);
  if (!Object.keys(memory.reminders).some((id) => ids.has(id))) return memory;
  const reminders: Record<string, string> = {};
  for (const [id, until] of Object.entries(memory.reminders)) {
    if (!ids.has(id)) reminders[id] = until;
  }
  return { ...memory, reminders };
}

function namesDue(step: GuidedStep, due: ReadonlySet<string>): boolean {
  switch (step.kind) {
    case "batch":
      return step.ruleIds.some((id) => due.has(id));
    case "fix":
    case "show":
      return due.has(step.ruleId);
    case "permission":
    case "paywall":
      return false;
  }
}

/** Steps naming a due id first, then the rest; both halves keep their order. The same array when nothing is due. */
export function dueFirst(steps: readonly GuidedStep[], due: readonly RuleId[]): readonly GuidedStep[] {
  if (due.length === 0) return steps;
  const set = new Set<string>(due);
  const first = steps.filter((step) => namesDue(step, set));
  if (first.length === 0) return steps;
  return [...first, ...steps.filter((step) => !namesDue(step, set))];
}
