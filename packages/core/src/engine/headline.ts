import type { Finding } from "../domain/finding";
import type { Rule } from "../domain/rule";

/** Opening words that are lower-cased even when a capitalised name follows ("The Guest account"). */
const DETERMINERS: ReadonlySet<string> = new Set(["the", "a", "an", "your", "no"]);

/** Lower-cases the first letter unless the title opens with an acronym, a brand such as "AirDrop" or a name such as "Remote Login". */
function lowerFirst(title: string): string {
  const [first = "", second = ""] = title.split(" ");
  const acronym = /^[A-Z]{2}/.test(first);
  const brand = /^[A-Z][a-z]+[A-Z]/.test(first);
  const name = /^[A-Z]/.test(second) && !DETERMINERS.has(first.toLowerCase());
  if (acronym || brand || name) {
    return title;
  }
  return title.charAt(0).toLowerCase() + title.slice(1);
}

/** Headline for a rule that could not be checked. */
export function unknownHeadline(title: string): string {
  return `Couldn't check whether ${lowerFirst(title)}`;
}

/** The status-aware headline the engine writes on every Finding. */
export function headlineFor(rule: Pick<Rule, "title" | "failTitle">, status: Finding["status"]): string {
  return status === "unknown" ? unknownHeadline(rule.title) : rule.failTitle;
}
