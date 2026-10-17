import type { GuidedPlan, RuleId } from "@talos/core";
import { guidedFor, ruleIdsOf } from "../guided/plan";

/** The accept grammar (docs/DESIGN-CHAT.md "Person turns", check 3). Core holds no copy of the synonyms. */

export const ACCEPT_PATTERNS: readonly RegExp[] = [
  /^(?:leave|skip|ignore|forget)\s+(.+?)(?:\s+alone)?[.!?]*$/i,
  /^i know\s+(?:about\s+)?(.+?)[.!?]*$/i,
  /^(?:don'?t|do not|stop)\s+(?:ask|bring|mention|remind)(?:ing)?\s+me\s+(?:about\s+)?(.+?)[.!?]*$/i,
];

/** A few words a person uses for a rule that its headline does not carry. Keyed by rule, lower-case. */
export const ACCEPT_SYNONYMS: Readonly<Partial<Record<RuleId, readonly string[]>>> = {
  "TL-MAC-001": ["disk", "filevault", "encrypt", "encryption", "encrypted"],
  "TL-MAC-002": ["firewall"],
  "TL-MAC-003": ["stealth", "firewall mode"],
  "TL-MAC-008": ["updates", "update", "macos updates"],
  "TL-MAC-010": ["screen lock", "lock screen", "screensaver"],
  "TL-MAC-011": ["app store", "app updates"],
  "TL-MAC-022": ["sharing", "shared folder", "share", "folder"],
  "TL-MAC-026": ["backup", "backups", "time machine"],
  "TL-MAC-029": ["login key", "ssh key", "key"],
};

/** Words that carry no item on their own. */
const STOP = new Set(["the", "a", "an", "my", "your", "it", "that", "this", "these", "those", "one", "thing", "is", "are", "not", "no", "on", "off", "do", "does", "has", "have", "mac", "me", "about", "alone", "its", "for", "of", "to", "from", "with", "and", "or", "in", "own", "their", "they", "them"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 0 && !STOP.has(w));
}

/** The captured phrase, or null when no pattern matches. */
export function acceptPhrase(text: string): string | null {
  const trimmed = text.trim();
  for (const pattern of ACCEPT_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return null;
}

function ruleMatches(ruleId: RuleId, phrase: string, phraseWords: readonly string[]): boolean {
  const lower = phrase.toLowerCase();
  for (const synonym of ACCEPT_SYNONYMS[ruleId] ?? []) if (lower.includes(synonym)) return true;
  const headline = new Set(words(guidedFor(ruleId).headline));
  return phraseWords.some((w) => headline.has(w));
}

/** The rules the phrase names among the plan's undone and later items, in plan order; empty when nothing matches. */
export function acceptMatches(text: string, plan: GuidedPlan, doneStepIds: readonly string[] = []): readonly RuleId[] {
  const phrase = acceptPhrase(text);
  if (phrase === null) return [];
  const phraseWords = words(phrase);
  if (phraseWords.length === 0) return [];
  const candidates: RuleId[] = [];
  for (const step of plan.steps) {
    if (doneStepIds.includes(step.id)) continue;
    for (const id of ruleIdsOf(step)) if (!candidates.includes(id)) candidates.push(id);
  }
  for (const id of plan.later) if (!candidates.includes(id)) candidates.push(id);
  return candidates.filter((id) => !plan.accepted.includes(id) && ruleMatches(id, phrase, phraseWords));
}
