import type { RuleId } from "../domain/finding";
import type { ScanReport } from "../domain/report";
import type { SignalId } from "../ports/watch-port";
import {
  EXPLAINER_LIMITS,
  SAFE_STRING_PATTERN,
  type Answer,
  type Explanation,
  type ExplainerResult,
  type Prioritisation,
} from "../ports/explainer-port";
import { ALLOWED_LIST_FOR, type Allowed } from "../chat/allowed";
import type { ChatResult } from "../chat/input";
import { INTENT_KINDS, INTENT_KINDS_WITHOUT_RULE, REMIND_WHENS, type ChatIntent, type IntentKind, type RemindWhen } from "../chat/intents";
import { CHAT_LIMITS } from "./limits";
import { claimsAction, claimsAppIdentity } from "./prose";

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

/** What the chat validators read of a report: the ids it carries. A ScanReport satisfies it; a demo may pass the ids alone. */
export interface KnownRules {
  readonly results: readonly { readonly ruleId: RuleId }[];
}

function reportRuleIds(report: KnownRules): ReadonlySet<string> {
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

/**
 * order must be a permutation of eligible: the ids the model was given (built.kept on-device,
 * explainerEligibleRuleIds(report) for Claude and Ollama). reasons and startWith may name any id in the report.
 */
export function validatePrioritisation(
  raw: unknown,
  report: ScanReport,
  eligible: readonly RuleId[],
): ExplainerResult<Prioritisation> {
  return guarded(() => {
    if (!isRecord(raw)) {
      throw new Rejected();
    }
    const known = reportRuleIds(report);
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

/** DESIGN-CHAT "Validator". Whole-response rules reject; intents are dropped per entry; locked collects the licence drops. */
export function validateChat(raw: unknown, report: KnownRules, allowed: Allowed, locked: readonly RuleId[]): ExplainerResult<ChatResult> {
  return guarded(() => {
    if (!isRecord(raw)) {
      throw new Rejected();
    }
    const known = reportRuleIds(report);
    const reply = readReply(raw["reply"]);
    const outsideScope = readBoolean(raw["outsideScope"]);
    const relatedRuleIds = readRelated(raw["relatedRuleIds"], known, allowed);
    const lockedSet = new Set<string>(locked);
    const lockedOut: RuleId[] = [];
    const kept: ChatIntent[] = [];
    const seen = new Set<string>();
    const rawIntents = Array.isArray(raw["intents"]) ? (raw["intents"] as readonly unknown[]) : [];
    for (const entry of rawIntents) {
      const intent = readIntent(entry, known, allowed, lockedSet, lockedOut);
      if (intent === null) continue;
      const key = ONE_EACH.includes(intent.kind) ? intent.kind : `${intent.kind}:${intent.ruleId ?? ""}:${intent.signalId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(intent);
    }
    const batchKept = kept.some((intent) => intent.kind === "fix_batch");
    const batchIds = new Set<string>(allowed.batch);
    const intents = kept
      .filter((intent) => !(batchKept && intent.kind === "fix_rule" && intent.ruleId !== null && batchIds.has(intent.ruleId)))
      .slice(0, CHAT_LIMITS.maxIntents);
    return { reply, relatedRuleIds, outsideScope, intents, locked: [...new Set(lockedOut)] };
  });
}

/** The ask-shaped reply (on this Mac, ChatGPT plainOutput): the prose rules, no intents, relatedRuleIds filtered per entry. */
export function validateChatAnswer(raw: unknown, report: KnownRules, allowed: Allowed): ExplainerResult<ChatResult> {
  return guarded(() => {
    if (!isRecord(raw)) {
      throw new Rejected();
    }
    const known = reportRuleIds(report);
    const text = typeof raw["answer"] === "string" ? raw["answer"] : raw["reply"];
    return {
      reply: readReply(text),
      relatedRuleIds: readRelated(raw["relatedRuleIds"], known, allowed),
      outsideScope: readBoolean(raw["outsideScope"]),
      intents: [],
      locked: [],
    };
  });
}

function readReply(value: unknown): string {
  const reply = readString(value, false);
  if (claimsAppIdentity(reply) || claimsAction(reply)) {
    throw new Rejected();
  }
  return reply;
}

function readBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Rejected();
  }
  return value;
}

/** Not an array rejects; each entry is kept only when it is a safe id in the report and neither accepted nor snoozed. */
function readRelated(value: unknown, known: ReadonlySet<string>, allowed: Allowed): readonly RuleId[] {
  if (!Array.isArray(value)) {
    throw new Rejected();
  }
  const dropped = new Set<string>([...allowed.accepted, ...allowed.snoozed]);
  const out: RuleId[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !SAFE_STRING_PATTERN.test(entry) || !known.has(entry) || dropped.has(entry) || out.includes(entry as RuleId)) {
      continue;
    }
    out.push(entry as RuleId);
  }
  return out.slice(0, CHAT_LIMITS.maxRelated);
}

/** Kinds kept at most once per reply, whatever ids they carry. */
const ONE_EACH: readonly IntentKind[] = ["fix_batch", "show_list", "rescan", "change_ai", "open_watch", "investigate", "close_watch", "write_up"];

/** One intent entry, or null when dropped. A locked fix, show or explain id lands in lockedOut instead. */
function readIntent(entry: unknown, known: ReadonlySet<string>, allowed: Allowed, locked: ReadonlySet<string>, lockedOut: RuleId[]): ChatIntent | null {
  if (!isRecord(entry)) return null;
  const kind = entry["kind"];
  if (typeof kind !== "string" || !INTENT_KINDS.includes(kind as IntentKind) || !allowed.kinds.includes(kind as IntentKind)) return null;
  const intentKind = kind as IntentKind;
  if (intentKind === "investigate") return readInvestigate(entry, known, allowed);
  if (INTENT_KINDS_WITHOUT_RULE.includes(intentKind)) {
    if (intentKind === "fix_batch" && allowed.batch.length === 0) return null;
    return { kind: intentKind, ruleId: null, signalId: null, when: null };
  }
  const ruleId = entry["ruleId"];
  if (typeof ruleId !== "string" || !SAFE_STRING_PATTERN.test(ruleId) || !known.has(ruleId)) return null;
  const id = ruleId as RuleId;
  if ((intentKind === "fix_rule" || intentKind === "show_where" || intentKind === "explain_rule") && locked.has(id)) {
    lockedOut.push(id);
    return null;
  }
  const list = ALLOWED_LIST_FOR[intentKind];
  if (list === undefined || !(allowed[list] as readonly RuleId[]).includes(id)) return null;
  if (intentKind === "remind_rule") {
    const when = entry["when"];
    if (typeof when !== "string" || !REMIND_WHENS.includes(when as RemindWhen)) return null;
    return { kind: intentKind, ruleId: id, signalId: null, when: when as RemindWhen };
  }
  return { kind: intentKind, ruleId: id, signalId: null, when: null };
}

/** A signal in allowed.investigate (membership only, never SAFE_STRING_PATTERN), else a rule in allowed.details, else dropped. */
function readInvestigate(entry: Record<string, unknown>, known: ReadonlySet<string>, allowed: Allowed): ChatIntent | null {
  const signalId = entry["signalId"];
  if (typeof signalId === "string" && (allowed.investigate as readonly string[]).includes(signalId)) {
    return { kind: "investigate", ruleId: null, signalId: signalId as SignalId, when: null };
  }
  const ruleId = entry["ruleId"];
  if (typeof ruleId === "string" && SAFE_STRING_PATTERN.test(ruleId) && known.has(ruleId) && allowed.details.includes(ruleId as RuleId)) {
    return { kind: "investigate", ruleId: ruleId as RuleId, signalId: null, when: null };
  }
  return null;
}
