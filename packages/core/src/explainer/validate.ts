import type { RuleId } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import {
  EXPLAINER_LIMITS,
  type Answer,
  type Explanation,
  type ExplainerResult,
  type Prioritisation,
} from "../ports/explainer-port";
import { explainerEligibleRuleIds } from "./context";

const REJECTED: ExplainerResult<never> = { ok: false, reason: "rejected_output" };

const URGENCIES: readonly Explanation["urgency"][] = ["today", "this_week", "when_convenient"];

const COMMAND_LINE_PREFIXES: readonly string[] = ["sudo ", "$ ", "curl ", "bash "];

class Rejected extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when the text carries a fenced block or a line that looks like a shell command. */
export function containsCommandText(text: string): boolean {
  if (text.includes("```") || text.includes("~~~")) {
    return true;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (COMMAND_LINE_PREFIXES.some((prefix) => line.startsWith(prefix))) {
      return true;
    }
  }
  return false;
}

function readString(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== "string") {
    throw new Rejected();
  }
  if (value.length > EXPLAINER_LIMITS.maxOutputStringChars) {
    throw new Rejected();
  }
  if (!allowEmpty && value.trim().length === 0) {
    throw new Rejected();
  }
  if (containsCommandText(value)) {
    throw new Rejected();
  }
  return value;
}

function readList(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Rejected();
  }
  return value;
}

function readRuleId(value: unknown, known: ReadonlySet<string>): RuleId {
  if (typeof value !== "string" || !known.has(value)) {
    throw new Rejected();
  }
  return value as RuleId;
}

function reportRuleIds(report: ScanReport): ReadonlySet<string> {
  return new Set(report.results.map((result) => result.ruleId));
}

function guarded<T>(build: () => T): ExplainerResult<T> {
  try {
    return { ok: true, value: build() };
  } catch (error) {
    if (error instanceof Rejected) {
      return REJECTED;
    }
    throw error;
  }
}

export function validateExplanation(raw: unknown, report: ScanReport): ExplainerResult<Explanation> {
  return guarded(() => {
    if (!isRecord(raw)) {
      throw new Rejected();
    }
    const known = reportRuleIds(report);
    const urgency = raw["urgency"];
    if (typeof urgency !== "string" || !URGENCIES.includes(urgency as Explanation["urgency"])) {
      throw new Rejected();
    }
    return {
      ruleId: readRuleId(raw["ruleId"], known),
      whyItMattersForYou: readString(raw["whyItMattersForYou"], false),
      whatCouldHappen: readString(raw["whatCouldHappen"], false),
      urgency: urgency as Explanation["urgency"],
    };
  });
}

export function validatePrioritisation(raw: unknown, report: ScanReport): ExplainerResult<Prioritisation> {
  return guarded(() => {
    if (!isRecord(raw)) {
      throw new Rejected();
    }
    const known = reportRuleIds(report);
    const eligible = explainerEligibleRuleIds(report);
    const orderRaw = readList(raw["order"], EXPLAINER_LIMITS.maxFindings);
    const order = orderRaw.map((id) => readRuleId(id, known));
    if (order.length !== eligible.length || new Set(order).size !== order.length) {
      throw new Rejected();
    }
    const eligibleSet = new Set<string>(eligible);
    if (!order.every((id) => eligibleSet.has(id))) {
      throw new Rejected();
    }
    const reasons = readList(raw["reasons"], EXPLAINER_LIMITS.maxOutputListItems).map((entry) => {
      if (!isRecord(entry)) {
        throw new Rejected();
      }
      return {
        ruleId: readRuleId(entry["ruleId"], known),
        reason: readString(entry["reason"], true),
      };
    });
    const startWith = readList(raw["startWith"], EXPLAINER_LIMITS.maxOutputListItems).map((id) =>
      readRuleId(id, known),
    );
    return { order, reasons, startWith };
  });
}

export function validateAnswer(raw: unknown, report: ScanReport): ExplainerResult<Answer> {
  return guarded(() => {
    if (!isRecord(raw)) {
      throw new Rejected();
    }
    const known = reportRuleIds(report);
    const outsideScope = raw["outsideScope"];
    if (typeof outsideScope !== "boolean") {
      throw new Rejected();
    }
    const relatedRuleIds = readList(raw["relatedRuleIds"], EXPLAINER_LIMITS.maxOutputListItems).map((id) =>
      readRuleId(id, known),
    );
    return {
      answer: readString(raw["answer"], false),
      relatedRuleIds,
      outsideScope,
    };
  });
}
