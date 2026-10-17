import { validateChat, validateChatAnswer } from "@talos/core";
import type {
  AiAvailability,
  Answer,
  AskInput,
  ExplainInput,
  ExplainOptions,
  ExplainerContext,
  ExplainerFailure,
  ExplainerFinding,
  ExplainerPort,
  ChatCall,
  ChatInput,
  ChatResult,
  ExplainerResult,
  Explanation,
  KnownRules,
  PrioritiseInput,
  Prioritisation,
  Rule,
  RuleCatalog,
  RuleId,
  Severity,
} from "@talos/core";
import { chatPartialOptions, chatPartialRejected } from "./explainer-shared";
import { recordDemoCall, wait } from "./demo-shared";

/** The canned chat replies, by the chat_reply demo param. The last three exercise the validator. */
export type DemoChatReply = "urgent" | "disk" | "leave_disk" | "cannot" | "outside" | "inject" | "too_many" | "app_voice" | "long";
export const DEMO_CHAT_REPLIES: readonly DemoChatReply[] = ["urgent", "disk", "leave_disk", "cannot", "outside", "inject", "too_many", "app_voice", "long"];

/** How the demo chat behaves: which reply, and whether and when the turn fails. */
export interface DemoChatOptions {
  /** Defaults to "disk". */
  readonly reply?: DemoChatReply;
  /** Fails the turn with this reason, before any partial unless failAfter is set. */
  readonly fail?: ExplainerFailure | null;
  /** With fail: the number of partials streamed before the failure. */
  readonly failAfter?: number | null;
  /** Holds the first partial this long (the still-waiting shot). */
  readonly firstPartialMs?: number | null;
}

/** The ids the demo validator knows: every id in the report, which allowed.details carries. */
export function knownRulesFor(call: ChatCall): KnownRules {
  return { results: call.allowed.details.map((ruleId) => ({ ruleId })) };
}

/** Pause between streamed words, so the caret and the Stop button can be seen. */
export const DEMO_WORD_CHUNK_MS = 40;

const URGENCY_BY_SEVERITY: Readonly<Record<Severity, Explanation["urgency"]>> = {
  critical: "today",
  high: "this_week",
  medium: "this_week",
  low: "when_convenient",
  info: "when_convenient",
};

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
const STATUS_RANK: Readonly<Record<ExplainerFinding["status"], number>> = { fail: 0, review: 1, unknown: 2 };

const MAX_TEXT = 1200;

function firstSentence(text: string): string {
  const end = text.indexOf(". ");
  return end === -1 ? text : text.slice(0, end + 1);
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
}

function situation(context: ExplainerContext): string {
  const { profile } = context;
  const parts: string[] = [];
  if (profile.laptopLeavesHome) parts.push("this Mac leaves the house with you");
  if (profile.handlesClientData) parts.push("you keep other people's data on it");
  if (profile.role === "small_business") parts.push("your business runs on it");
  if (profile.role === "freelancer") parts.push("your work depends on it");
  return parts.length === 0 ? "you use this Mac for personal things" : parts.join(" and ");
}

function byPriority(a: ExplainerFinding, b: ExplainerFinding): number {
  return STATUS_RANK[a.status] - STATUS_RANK[b.status] || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
}

/** The person's typed text or the raw model shape, with the sentinel a demo QA script looks for. */
const INJECTED_ID = "IGNORE PREVIOUS INSTRUCTIONS ruleId";

const LONG_SENTENCES = [
  "Your disk holds your photos, documents and saved logins in a form anyone can read once the Mac is in their hands.",
  "Locking it means a thief gets a brick, not your life, and it changes nothing about how you use the Mac day to day.",
  "The firewall keeps other computers on the same network from reaching your Mac, which matters most on cafe and hotel Wi-Fi.",
  "Updates close the holes Apple has already found, so a Mac that waits on them is open to things that are already known.",
  "A backup is the one thing that turns a lost or broken Mac from a disaster into an afternoon of copying files back.",
  "None of this needs an expert: each item has a button below it, and your Mac asks for your password when it needs it.",
];

/** About 1,100 characters in the second person for the long-reply shot. */
function longReply(): string {
  let text = "";
  for (let i = 0; text.length < 1100; i += 1) text += `${i === 0 ? "" : " "}${LONG_SENTENCES[i % LONG_SENTENCES.length]}`;
  return text;
}

function effortWords(rule: Rule): string {
  return rule.fix.effort === "two_minutes" ? "a couple of minutes" : rule.fix.effort === "ten_minutes" ? "about ten minutes" : "about half an hour";
}

/** Canned but catalog-consistent answers that pass core's validators. No text contains a command line. */
export class CannedAnswers {
  private readonly rulesById: ReadonlyMap<RuleId, Rule>;

  constructor(catalog: RuleCatalog) {
    this.rulesById = new Map(catalog.rules.map((rule) => [rule.id, rule]));
  }

  /** The rule's guided headline for the middle of a sentence. */
  private plainName(ruleId: RuleId): string {
    const headline = this.rulesById.get(ruleId)?.guided.headline ?? ruleId;
    return headline.charAt(0).toLowerCase() + headline.slice(1);
  }

  /**
   * The raw chat shape for one canned reply, before the validator: urgent, disk, leave_disk, cannot and outside
   * read as the model would answer on this fixture; inject, too_many and app_voice carry what the validator must
   * drop or reject; long is the 1,100-character reply.
   */
  chat(input: ChatInput, reply: DemoChatReply): Record<string, unknown> {
    const { allowed } = input;
    const kindFor = (id: RuleId): "fix_rule" | "show_where" | "open_details" => (allowed.fix.includes(id) ? "fix_rule" : allowed.show.includes(id) ? "show_where" : "open_details");
    const card = (id: RuleId) => ({ kind: kindFor(id), ruleId: id });
    const base = { relatedRuleIds: [] as string[], outsideScope: false, intents: [] as Record<string, unknown>[] };
    switch (reply) {
      case "urgent": {
        const id = allowed.show[0] ?? allowed.fix[0] ?? allowed.batch[0];
        if (id === undefined) return { ...base, reply: "Nothing urgent is left: every check that could run passed or is already in hand." };
        return { ...base, reply: `The one to do first: ${this.plainName(id)}. It costs the most of what is left and it takes a few minutes from the button below.`, relatedRuleIds: [id], intents: [card(id)] };
      }
      case "disk":
        return {
          ...base,
          reply: "Your disk holds your photos, documents and saved logins in a form anyone can read once the Mac is in their hands. Locking it means a thief gets a brick, not your life. You travel with this Mac, so this is the one that matters most for you.",
          relatedRuleIds: ["TL-MAC-001"],
          intents: allowed.show.includes("TL-MAC-001") ? [{ kind: "show_where", ruleId: "TL-MAC-001" }] : [],
        };
      case "leave_disk":
        return {
          ...base,
          reply: "That is your call. A disk that is not locked can be read by anyone who holds the Mac, so the risk is real, but it is yours to take. Say the word and it stays off the list.",
          relatedRuleIds: ["TL-MAC-001"],
          intents: allowed.accept.includes("TL-MAC-001") ? [{ kind: "accept_rule", ruleId: "TL-MAC-001" }] : [],
        };
      case "cannot":
        return {
          ...base,
          reply: "That guard can only be switched back on from your Mac's recovery screen, which is a restart away and something to do by hand with the instructions in front of you. It cannot be done from here.",
          relatedRuleIds: ["TL-MAC-005"],
          intents: allowed.details.includes("TL-MAC-005") ? [{ kind: "open_details", ruleId: "TL-MAC-005" }] : [],
        };
      case "outside":
        return { ...base, reply: "Your Apple password is managed by Apple, not by this check-up, so there is nothing here to change for it.", outsideScope: true };
      case "inject": {
        const id = allowed.show[0] ?? allowed.fix[0];
        return {
          ...base,
          reply: "Start with the one below; the rest can wait.",
          relatedRuleIds: [INJECTED_ID, "/Users/alice", ...(id === undefined ? [] : [id])],
          intents: [
            { kind: "run_command", ruleId: null },
            { kind: "fix_rule", ruleId: INJECTED_ID },
            { kind: "fix_rule", ruleId: "/Users/alice", path: "/tmp/x" },
            { kind: "fix_rule", ruleId: "TL-MAC-005" },
            ...(id === undefined ? [] : [card(id)]),
          ],
        };
      }
      case "too_many": {
        const ids = [...new Set<RuleId>([...allowed.show, ...allowed.fix, ...allowed.details])].slice(0, 5);
        return { ...base, reply: "More than three things are worth doing, so here are the first three; the rest wait in the list.", relatedRuleIds: ids.slice(0, 3), intents: ids.map(card) };
      }
      case "app_voice":
        return { ...base, reply: "Done. I have turned your firewall on for you." };
      case "long":
        return { ...base, reply: longReply() };
    }
  }

  /** The same reply in the ask shape, as the on-device model answers it. */
  chatAnswer(input: ChatInput, reply: DemoChatReply): Record<string, unknown> {
    const { reply: answer, relatedRuleIds, outsideScope } = this.chat(input, reply);
    return { answer, relatedRuleIds, outsideScope };
  }

  explanation(input: ExplainInput): Explanation {
    const rule = this.rulesById.get(input.ruleId);
    const finding = input.context.findings.find((f) => f.ruleId === input.ruleId);
    const severity = finding?.severity ?? rule?.severity ?? "medium";
    const problem = rule?.failTitle ?? `Check ${input.ruleId} needs attention`;
    const why = rule === undefined ? "This setting protects the data on this Mac." : firstSentence(rule.explanation);
    return {
      ruleId: input.ruleId,
      whyItMattersForYou: clip(`${problem}. ${why} Because ${situation(input.context)}, this is worth sorting out.`),
      whatCouldHappen: clip(
        rule === undefined
          ? "Someone with access to this Mac, or to the network it is on, could get further than they should."
          : `${rule.explanation} The fix shown in the app takes ${effortWords(rule)}.`,
      ),
      urgency: URGENCY_BY_SEVERITY[severity],
    };
  }

  /** The order is a permutation of `eligible` (the context's ids unless the caller narrows them); a row the person chose to leave is never in it. */
  prioritisation(input: PrioritiseInput, eligible?: readonly RuleId[]): Prioritisation {
    const allowed = eligible === undefined ? null : new Set<string>(eligible);
    const ordered = [...input.context.findings].filter((f) => !f.accepted && (allowed === null || allowed.has(f.ruleId))).sort(byPriority);
    const order = ordered.map((f) => f.ruleId);
    const failing = ordered.filter((f) => f.status === "fail");
    const reasons = failing.slice(0, 3).map((f) => {
      const rule = this.rulesById.get(f.ruleId);
      const points = f.points > 0 ? ` It is worth ${f.points} points.` : "";
      return {
        ruleId: f.ruleId,
        reason: clip(rule === undefined ? `Fix this early.${points}` : `${rule.failTitle}. ${firstSentence(rule.explanation)}${points}`),
      };
    });
    return { order, reasons, startWith: failing.slice(0, 3).map((f) => f.ruleId) };
  }

  answer(input: AskInput): Answer {
    const top = [...input.context.findings].filter((f) => f.status === "fail").sort(byPriority).slice(0, 3);
    if (top.length === 0) {
      return {
        answer: "Every check that could run passed, so there is nothing to fix first. Rescan now and then to keep it that way.",
        relatedRuleIds: [],
        outsideScope: false,
      };
    }
    const names = top.map((f) => this.rulesById.get(f.ruleId)?.failTitle.toLowerCase() ?? f.ruleId);
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return {
      answer: clip(
        `Start with these: ${list}. They cost the most points and, because ${situation(input.context)}, they matter most. Open each item in the app and follow the fix shown there.`,
      ),
      relatedRuleIds: top.map((f) => f.ruleId),
      outsideScope: false,
    };
  }
}

/** Developer-mode providers: one answer after a delay, shown as one partial then done. */
export class DemoExplainer implements ExplainerPort {
  private readonly canned: CannedAnswers;

  constructor(
    readonly id: "claude" | "ollama",
    catalog: RuleCatalog,
    private readonly failure: ExplainerFailure | null,
    private readonly delayMs: number,
    private readonly chatOptions: DemoChatOptions = {},
  ) {
    this.canned = new CannedAnswers(catalog);
  }

  async availability(_fresh?: boolean): Promise<AiAvailability> {
    return "available";
  }

  private async settle<T>(build: () => T, options?: ExplainOptions<T>): Promise<ExplainerResult<T>> {
    try {
      await wait(this.delayMs, options?.signal);
    } catch {
      return { ok: false, reason: "cancelled" };
    }
    if (this.failure !== null) return { ok: false, reason: this.failure };
    const value = build();
    options?.onPartial?.(value);
    return { ok: true, value };
  }

  explain(input: ExplainInput, options?: ExplainOptions<Explanation>): Promise<ExplainerResult<Explanation>> {
    return this.settle(() => this.canned.explanation(input), options);
  }

  prioritise(input: PrioritiseInput, options?: ExplainOptions<Prioritisation>): Promise<ExplainerResult<Prioritisation>> {
    return this.settle(() => this.canned.prioritisation(input), options);
  }

  ask(input: AskInput, options?: ExplainOptions<Answer>): Promise<ExplainerResult<Answer>> {
    return this.settle(() => this.canned.answer(input), options);
  }

  /** One partial then done, after the delay; the canned reply runs through the real validator. */
  async chat(call: ChatCall, options?: ExplainOptions<ChatResult>): Promise<ExplainerResult<ChatResult>> {
    const chat = this.chatOptions;
    if (chat.fail !== undefined && chat.fail !== null) return { ok: false, reason: chat.fail };
    const result = await this.settle(() => this.canned.chat(call.input, chat.reply ?? "disk"), chatPartialOptions(options) as ExplainOptions<Record<string, unknown>>);
    if (!result.ok) return result;
    return validateChat(result.value, knownRulesFor(call), call.allowed, call.locked);
  }
}

/** What streamFields does besides pacing: the first-partial hold, a failure after N partials, a guard on each partial. */
export interface StreamFieldsExtras {
  readonly firstPartialMs?: number | null;
  readonly failAfter?: { readonly partials: number; readonly reason: ExplainerFailure } | null;
  /** True cancels the stream as rejected_output before the partial is forwarded. */
  readonly rejectPartial?: (snapshot: unknown) => boolean;
}

/** Streams each string field of `value` in word chunks; every partial is the whole snapshot so far. */
export async function streamFields<T extends object>(
  value: T,
  fields: readonly (keyof T)[],
  chunkMs: number,
  options?: ExplainOptions<T>,
  extras: StreamFieldsExtras = {},
): Promise<ExplainerResult<T>> {
  const snapshot: Partial<T> = {};
  let partials = 0;
  const forward = (): ExplainerResult<T> | null => {
    if (extras.failAfter !== undefined && extras.failAfter !== null && partials >= extras.failAfter.partials) {
      return { ok: false, reason: extras.failAfter.reason };
    }
    if (extras.rejectPartial?.(snapshot) === true) {
      recordDemoCall({ kind: "aiCancel" });
      return { ok: false, reason: "rejected_output" };
    }
    partials += 1;
    options?.onPartial?.({ ...snapshot });
    return null;
  };
  try {
    if (typeof extras.firstPartialMs === "number" && extras.firstPartialMs > 0) await wait(extras.firstPartialMs, options?.signal);
    for (const field of fields) {
      const text = value[field];
      if (typeof text !== "string") {
        snapshot[field] = text;
        const stopped = forward();
        if (stopped !== null) return stopped;
        continue;
      }
      const words = text.split(" ");
      for (let i = 1; i <= words.length; i += 1) {
        await wait(chunkMs, options?.signal);
        snapshot[field] = words.slice(0, i).join(" ") as T[keyof T];
        const stopped = forward();
        if (stopped !== null) return stopped;
      }
    }
  } catch {
    recordDemoCall({ kind: "aiCancel" });
    return { ok: false, reason: "cancelled" };
  }
  return { ok: true, value };
}

/** The streamFields extras for one demo chat turn. */
export function chatStreamExtras(chat: DemoChatOptions): StreamFieldsExtras {
  const failAfter = chat.fail !== undefined && chat.fail !== null && typeof chat.failAfter === "number" && chat.failAfter > 0 ? { partials: chat.failAfter, reason: chat.fail } : null;
  return { firstPartialMs: chat.firstPartialMs ?? null, failAfter, rejectPartial: chatPartialRejected };
}

export interface DemoAppleOptions {
  readonly catalog: RuleCatalog;
  readonly availability: AiAvailability;
  /** After this long, model_not_ready reports available. */
  readonly readyAfterMs?: number | null;
  readonly failure?: ExplainerFailure | null;
  readonly chunkMs?: number;
  readonly chat?: DemoChatOptions;
}

/** Streams the canned answers word by word, the way the on-device model does. */
export class DemoAppleExplainer implements ExplainerPort {
  readonly id = "apple" as const;
  private readonly canned: CannedAnswers;
  private readonly bornAt = Date.now();

  constructor(private readonly options: DemoAppleOptions) {
    this.canned = new CannedAnswers(options.catalog);
  }

  async availability(_fresh?: boolean): Promise<AiAvailability> {
    const { availability, readyAfterMs } = this.options;
    if (availability === "model_not_ready" && typeof readyAfterMs === "number" && Date.now() - this.bornAt >= readyAfterMs) {
      return "available";
    }
    return availability;
  }

  /** Streams each string field in word chunks; every partial is the whole snapshot so far. */
  private async stream<T extends object>(
    value: T,
    fields: readonly (keyof T)[],
    options?: ExplainOptions<T>,
  ): Promise<ExplainerResult<T>> {
    if (this.options.failure !== undefined && this.options.failure !== null) return { ok: false, reason: this.options.failure };
    if ((await this.availability()) !== "available") return { ok: false, reason: "unavailable" };
    return streamFields(value, fields, this.options.chunkMs ?? DEMO_WORD_CHUNK_MS, options);
  }

  explain(input: ExplainInput, options?: ExplainOptions<Explanation>): Promise<ExplainerResult<Explanation>> {
    return this.stream(this.canned.explanation(input), ["ruleId", "whyItMattersForYou", "whatCouldHappen", "urgency"], options);
  }

  async prioritise(input: PrioritiseInput, options?: ExplainOptions<Prioritisation>): Promise<ExplainerResult<Prioritisation>> {
    // prioritise emits no partials: one pause, then the whole answer.
    if (this.options.failure !== undefined && this.options.failure !== null) return { ok: false, reason: this.options.failure };
    if ((await this.availability()) !== "available") return { ok: false, reason: "unavailable" };
    try {
      await wait((this.options.chunkMs ?? DEMO_WORD_CHUNK_MS) * 12, options?.signal);
    } catch {
      recordDemoCall({ kind: "aiCancel" });
      return { ok: false, reason: "cancelled" };
    }
    return { ok: true, value: this.canned.prioritisation(input) };
  }

  ask(input: AskInput, options?: ExplainOptions<Answer>): Promise<ExplainerResult<Answer>> {
    return this.stream(this.canned.answer(input), ["answer", "relatedRuleIds", "outsideScope"], options);
  }

  /** Streams the ask shape word by word, as this Mac does; partials reach the chat as { reply }, no intents. */
  async chat(call: ChatCall, options?: ExplainOptions<ChatResult>): Promise<ExplainerResult<ChatResult>> {
    const chat = this.options.chat ?? {};
    if (chat.fail !== undefined && chat.fail !== null && !(typeof chat.failAfter === "number" && chat.failAfter > 0)) return { ok: false, reason: chat.fail };
    if ((await this.availability()) !== "available") return { ok: false, reason: "unavailable" };
    const value = this.canned.chatAnswer(call.input, chat.reply ?? "disk");
    const result = await streamFields(value, ["answer", "relatedRuleIds", "outsideScope"], this.options.chunkMs ?? DEMO_WORD_CHUNK_MS, chatPartialOptions(options) as ExplainOptions<Record<string, unknown>>, chatStreamExtras(chat));
    if (!result.ok) return result;
    return validateChatAnswer(result.value, knownRulesFor(call), call.allowed);
  }
}
