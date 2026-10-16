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
  ExplainerResult,
  Explanation,
  PrioritiseInput,
  Prioritisation,
  Rule,
  RuleCatalog,
  RuleId,
  Severity,
} from "@talos/core";
import { recordDemoCall, wait } from "./demo-shared";

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

function effortWords(rule: Rule): string {
  return rule.fix.effort === "two_minutes" ? "a couple of minutes" : rule.fix.effort === "ten_minutes" ? "about ten minutes" : "about half an hour";
}

/** Canned but catalog-consistent answers that pass core's validators. No text contains a command line. */
export class CannedAnswers {
  private readonly rulesById: ReadonlyMap<RuleId, Rule>;

  constructor(catalog: RuleCatalog) {
    this.rulesById = new Map(catalog.rules.map((rule) => [rule.id, rule]));
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

  /** The order is a permutation of `eligible` (the context's ids unless the caller narrows them). */
  prioritisation(input: PrioritiseInput, eligible?: readonly RuleId[]): Prioritisation {
    const allowed = eligible === undefined ? null : new Set<string>(eligible);
    const ordered = [...input.context.findings].filter((f) => allowed === null || allowed.has(f.ruleId)).sort(byPriority);
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
}

export interface DemoAppleOptions {
  readonly catalog: RuleCatalog;
  readonly availability: AiAvailability;
  /** After this long, model_not_ready reports available. */
  readonly readyAfterMs?: number | null;
  readonly failure?: ExplainerFailure | null;
  readonly chunkMs?: number;
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
    const chunkMs = this.options.chunkMs ?? DEMO_WORD_CHUNK_MS;
    const snapshot: Partial<T> = {};
    try {
      for (const field of fields) {
        const text = value[field];
        if (typeof text !== "string") {
          snapshot[field] = text;
          options?.onPartial?.({ ...snapshot });
          continue;
        }
        const words = text.split(" ");
        for (let i = 1; i <= words.length; i += 1) {
          await wait(chunkMs, options?.signal);
          snapshot[field] = words.slice(0, i).join(" ") as T[keyof T];
          options?.onPartial?.({ ...snapshot });
        }
      }
    } catch {
      recordDemoCall({ kind: "aiCancel" });
      return { ok: false, reason: "cancelled" };
    }
    return { ok: true, value };
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
}
