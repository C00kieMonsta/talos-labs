import type { RuleId } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { GuidedMemory } from "./memory";
import { KEEP_ACCEPTED_THROUGH_PASS } from "./plan";

/** True when the person said "Leave it alone, I know the risk" for this rule. */
export function isAccepted(memory: Pick<GuidedMemory, "accepted">, ruleId: RuleId): boolean {
  return memory.accepted[ruleId] !== undefined;
}

/** Accepted ids whose finding has status "fail", in report.results order. The only reader screens use. */
export function acceptedFailing(memory: Pick<GuidedMemory, "accepted">, report: ScanReport): readonly RuleId[] {
  return report.results.filter((result) => result.status === "fail" && memory.accepted[result.ruleId] !== undefined).map((result) => result.ruleId);
}

function without<T>(map: Readonly<Record<string, T>>, ids: ReadonlySet<string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    if (!ids.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

/** accepted[id] = now for each id; their snoozed, laterCount, waiting and reminders entries go; everything else is untouched. */
export function acceptRules(memory: GuidedMemory, ruleIds: readonly RuleId[], now: string): GuidedMemory {
  if (ruleIds.length === 0) {
    return memory;
  }
  const ids = new Set<string>(ruleIds);
  const accepted: Record<string, string> = { ...memory.accepted };
  for (const id of ruleIds) {
    accepted[id] = now;
  }
  return {
    ...memory,
    snoozed: without(memory.snoozed, ids),
    laterCount: without(memory.laterCount, ids),
    waiting: without(memory.waiting, ids),
    accepted,
    reminders: without(memory.reminders, ids),
  };
}

/** Removes only accepted[ruleId]. Same object when absent. */
export function unacceptRule(memory: GuidedMemory, ruleId: RuleId): GuidedMemory {
  if (memory.accepted[ruleId] === undefined) {
    return memory;
  }
  return { ...memory, accepted: without(memory.accepted, new Set([ruleId])) };
}

/**
 * Drops an accepted id whose result is "pass" or "not_applicable", except KEEP_ACCEPTED_THROUGH_PASS.
 * fail, review, unknown and a missing result keep the entry. Same object when nothing changes.
 */
export function clearAcceptedThatPass(memory: GuidedMemory, report: ScanReport): GuidedMemory {
  const cleared = new Set<string>();
  for (const result of report.results) {
    if (memory.accepted[result.ruleId] === undefined || KEEP_ACCEPTED_THROUGH_PASS.includes(result.ruleId)) {
      continue;
    }
    if (result.status === "pass" || result.status === "not_applicable") {
      cleared.add(result.ruleId);
    }
  }
  if (cleared.size === 0) {
    return memory;
  }
  return { ...memory, accepted: without(memory.accepted, cleared) };
}
