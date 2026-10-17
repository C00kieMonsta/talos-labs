import type { RemindWhen, RuleId } from "@talos/core";
import { matchRules, namesNothing } from "./accept-grammar";

/**
 * The agent grammars (docs/DESIGN-AGENT.md section 4 "Grammars"): the typed forms of the five intents, routed after the
 * composer's machine-text guard and the accept grammar, before any call. A phrase that names nothing falls through (null).
 */

export type GrammarMatch =
  | { readonly kind: "remind"; readonly ruleId: RuleId; readonly when: RemindWhen }
  | { readonly kind: "what_if"; readonly ruleId: RuleId }
  | { readonly kind: "write_up" }
  | { readonly kind: "investigate"; readonly ruleId: RuleId | null }
  | { readonly kind: "close_watch" };

export interface GrammarContext {
  /** The plan's undone and later ids: what a reminder may name. */
  readonly undone: readonly RuleId[];
  /** Every failing rule (allowed.whatIf): what a what-if or a look-into may name. */
  readonly failing: readonly RuleId[];
  /** The newest card's rule, for a form with no phrase. */
  readonly newestRuleId: RuleId | null;
}

const END = "[.!?]*$";

const REMIND_A = new RegExp(`^(?:(?:ask|remind|tell) me|bring (?:this|it) up)(?: again)?(?: about (.+?))? (tomorrow|on sunday|sunday)(?: about (.+?))?${END}`, "i");
const REMIND_B = new RegExp(`^(tomorrow|on sunday)[,.]? (?:ask|remind) me(?: again)?(?: about (.+?))?${END}`, "i");
const WHAT_IF = new RegExp(`^what (?:if|happens if|would happen if) i (?:leave|skip|ignore|don'?t (?:do|fix|lock|turn on)) (.+?)(?: alone)?\\??${END}`, "i");
const WRITE_UP = [new RegExp(`^(?:write|type|put) (?:this|it) up(?: for .+)?${END}`, "i"), new RegExp(`^(?:give|make|send) me a summary.*$`, "i")];
const LOOK_BARE = new RegExp(`^(?:look into (?:this|it|that)|look closer(?: at (?:this|it|that))?|check (?:this|that|it) again|dig into (?:this|it|that))${END}`, "i");
const LOOK_PHRASE = new RegExp(`^(?:look into|look closer at|dig into) (.+?)(?: again)?${END}`, "i");
const CLOSER = new RegExp(`^(?:watch|check) (?:this |it )?(?:closer|more often)(?: for an hour)?${END}`, "i");

function whenOf(word: string): RemindWhen {
  return word.toLowerCase() === "tomorrow" ? "tomorrow" : "sunday";
}

/** The candidate the phrase names; with no phrase, or one of stop words, the newest card's rule when it is a candidate. */
function resolve(phrase: string | undefined, candidates: readonly RuleId[], fallback: RuleId | null): RuleId | null {
  if (phrase === undefined || namesNothing(phrase)) return fallback !== null && candidates.includes(fallback) ? fallback : null;
  return matchRules(phrase, candidates)[0] ?? null;
}

/** The intent the typed text stands for, or null when no grammar matches or the phrase names nothing. */
export function grammarMatch(text: string, context: GrammarContext): GrammarMatch | null {
  const trimmed = text.trim();
  const a = REMIND_A.exec(trimmed);
  const b = a === null ? REMIND_B.exec(trimmed) : null;
  if (a !== null || b !== null) {
    const phrase = a !== null ? (a[1] ?? a[3]) : b?.[2];
    const when = whenOf((a !== null ? a[2] : b?.[1]) ?? "");
    const ruleId = resolve(phrase, context.undone, context.newestRuleId);
    return ruleId === null ? null : { kind: "remind", ruleId, when };
  }
  const whatIf = WHAT_IF.exec(trimmed);
  if (whatIf !== null) {
    const ruleId = resolve(whatIf[1], context.failing, context.newestRuleId);
    return ruleId === null ? null : { kind: "what_if", ruleId };
  }
  if (WRITE_UP.some((p) => p.test(trimmed))) return { kind: "write_up" };
  if (CLOSER.test(trimmed)) return { kind: "close_watch" };
  if (LOOK_BARE.test(trimmed)) return { kind: "investigate", ruleId: context.newestRuleId };
  const look = LOOK_PHRASE.exec(trimmed);
  if (look !== null) {
    const ruleId = resolve(look[1], context.failing, context.newestRuleId);
    return ruleId === null ? null : { kind: "investigate", ruleId };
  }
  return null;
}
