import type { Allowed, ChatCard, ChatCardKind, ChatIntent, GuidedPlan, GuidedStep, RuleId, Severity, WatchItem } from "@talos/core";
import { intentToCard, stillAllowed } from "@talos/core";
import { ACCEPT, ACTIVITY, BATCH, CHAT, END, FISHY, FIX, PAYWALL, PERMISSION, QUESTION, SHOW, WATCH } from "../guided/copy";
import { guidedFor, ruleIdsOf, severityFor } from "../guided/plan";
import type { CardSeed } from "./state";

/** Cards are built from the catalogue and the plan, never from the model (docs/DESIGN-CHAT.md "Action cards"). */

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** The highest severity among the ids; null for none. */
export function severityOf(ruleIds: readonly RuleId[]): Severity | null {
  let best: Severity | null = null;
  for (const id of ruleIds) {
    const s = severityFor(id);
    if (best === null || SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s;
  }
  return best;
}

function kindForStep(step: GuidedStep): ChatCardKind {
  switch (step.kind) {
    case "batch":
      return "batch";
    case "fix":
      return "fix";
    case "show":
      return "show";
    case "permission":
      return "permission";
    case "paywall":
      return "lock";
  }
}

/** The card a plan step draws. */
export function seedForStep(step: GuidedStep): CardSeed {
  const ruleIds = step.kind === "paywall" ? step.lockedRuleIds : ruleIdsOf(step);
  const card: ChatCard = { kind: kindForStep(step), ruleId: ruleIds.length === 1 && step.kind !== "batch" ? (ruleIds[0] ?? null) : null, ruleIds, severity: severityOf(ruleIds) };
  return { card, step, item: null };
}

/** The step a validated intent points at, when the plan still holds it. */
export function stepForIntent(intent: ChatIntent, plan: GuidedPlan): GuidedStep | null {
  if (intent.kind === "fix_batch") return plan.steps.find((s) => s.kind === "batch") ?? null;
  if (intent.ruleId === null) return null;
  const wanted = intent.kind === "fix_rule" ? "fix" : intent.kind === "show_where" ? "show" : null;
  if (wanted === null) return null;
  return plan.steps.find((s) => s.kind === wanted && s.ruleId === intent.ruleId) ?? null;
}

/**
 * The card for an intent, re-checked against the live allow-lists at render and at tap. Null when the item left
 * `allowed` or the plan no longer holds its step; show_list draws rows and returns null here too.
 */
export function cardFor(intent: ChatIntent, plan: GuidedPlan, allowed: Allowed): CardSeed | null {
  if (!stillAllowed(intent, allowed)) return null;
  const step = stepForIntent(intent, plan);
  if (intent.kind === "fix_rule" || intent.kind === "fix_batch" || intent.kind === "show_where") {
    return step === null ? null : seedForStep(step);
  }
  // DESIGN-AGENT part B: three kinds are app messages, the write-up is its own card, the what-if answers over the rule's step.
  if (intent.kind === "remind_rule" || intent.kind === "close_watch" || intent.kind === "investigate") return null;
  if (intent.kind === "write_up") return writeUpCard();
  if (intent.kind === "what_if") return intent.ruleId === null ? null : whatIfCard(intent.ruleId, plan);
  const severity = intent.ruleId === null ? null : severityFor(intent.ruleId);
  const card = intentToCard(intent, severity);
  return card === null ? null : { card, step, item: null };
}

/** The write-up card; the controller fills the seed's text. */
export function writeUpCard(text?: string): CardSeed {
  return { card: { kind: "write_up", ruleId: null, ruleIds: [], severity: null }, step: null, item: null, ...(text === undefined ? {} : { text }) };
}

/** The what-if answer's card: the rule's own step (a batch as the batch card), else a Details card for a rule with no step. */
export function whatIfCard(ruleId: RuleId, plan: GuidedPlan): CardSeed {
  const step = plan.steps.find((s) => (s.kind === "fix" || s.kind === "show" || s.kind === "batch") && ruleIdsOf(s).includes(ruleId)) ?? null;
  if (step !== null) return seedForStep(step);
  return { card: { kind: "details", ruleId, ruleIds: [ruleId], severity: severityFor(ruleId) }, step: null, item: null };
}

/** The free version's one card per check-up, over the locked ids. */
export function lockCard(ruleIds: readonly RuleId[]): CardSeed {
  return { card: { kind: "lock", ruleId: null, ruleIds, severity: null }, step: null, item: null };
}

/** The watch's card: "See what to do" on an act-now item. */
export function watchCard(item: WatchItem | null): CardSeed {
  return { card: { kind: "watch", ruleId: null, ruleIds: [], severity: item?.severity ?? null }, step: null, item };
}

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

/** The card's headline, from the catalogue or the authored copy. */
export function cardHeadline(seed: CardSeed): string {
  const { card, step, item } = seed;
  switch (card.kind) {
    case "batch":
      return `I can fix ${things(card.ruleIds.length)} for you now.`;
    case "permission":
      return PERMISSION.title;
    case "lock":
      return card.ruleIds.length === 1 ? CHAT.lockHeadlineOne : CHAT.lockHeadline.replace("{n}", String(card.ruleIds.length));
    case "rescan":
      return CHAT.rescanHeadline;
    case "change_ai":
      return CHAT.changeAiHeadline;
    case "watch":
      return item === null ? CHAT.watchHeadline : CHAT.actHeadline.replace("{headline}", lowerFirst(FISHY.noticed.headline[item.kind]));
    case "question":
      return QUESTION.ask;
    case "write_up":
      return ACTIVITY.chips.writeUp;
    case "accept":
    case "snooze":
    case "details":
    case "explain":
    case "fix":
    case "show":
      if (card.ruleId !== null) return guidedFor(card.ruleId).headline;
      return step !== null && (step.kind === "fix" || step.kind === "show") ? guidedFor(step.ruleId).headline : "";
  }
}

export function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0]!.toLowerCase() + text.slice(1);
}

export interface CardFacts {
  /** The fix step's finding says whether macOS will ask for the password. */
  readonly needsPassword: boolean;
  /** Pre-formatted time for the watch card, or null. */
  readonly noticedTime: string | null;
}

export interface CardContent {
  readonly headline: string;
  readonly body: string | null;
  /** A second, quieter line under the body (the password sentence, the source line). */
  readonly meta: string | null;
  readonly list: readonly string[];
  readonly primary: string | null;
  readonly link: string | null;
  readonly explainRuleId: RuleId | null;
  /** 029: the PassphraseForm replaces the primary. */
  readonly passphrase: boolean;
  readonly keyPath: string | null;
  /** 022: the shared folder's name from the step's own path. */
  readonly folder: string | null;
  /** The lock card's licence field sits between the primary and the link. */
  readonly licence: boolean;
  readonly urgent: boolean;
}

function folderName(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

const EMPTY: Omit<CardContent, "headline"> = { body: null, meta: null, list: [], primary: null, link: null, explainRuleId: null, passphrase: false, keyPath: null, folder: null, licence: false, urgent: false };

/** Everything ChatCard draws for an idle card. Nothing here comes from the model. */
export function cardContent(seed: CardSeed, facts: CardFacts): CardContent {
  const { card, step, item } = seed;
  const headline = cardHeadline(seed);
  const why = card.ruleId !== null ? guidedFor(card.ruleId).why : null;
  switch (card.kind) {
    case "fix": {
      const fix = step !== null && step.kind === "fix" ? step : null;
      const verb = card.ruleId !== null ? guidedFor(card.ruleId).verb : FIX.tryAgain;
      return {
        ...EMPTY,
        headline,
        body: `${why ?? ""} ${FIX.canFix}`.trim(),
        meta: facts.needsPassword ? FIX.password : FIX.noPassword,
        primary: fix?.passphrase === true ? null : verb,
        link: FIX.later,
        explainRuleId: card.ruleId,
        passphrase: fix?.passphrase === true,
        keyPath: fix?.choice.kind === "ssh_key" ? fix.choice.path : null,
        folder: fix?.choice.kind === "share" ? folderName(fix.choice.path) : null,
      };
    }
    case "batch":
      return { ...EMPTY, headline, body: BATCH.password, list: card.ruleIds.map((id) => guidedFor(id).headline), primary: BATCH.button, link: BATCH.later, explainRuleId: card.ruleIds[0] ?? null };
    case "show": {
      const question = step !== null && step.kind === "show" && step.question !== null;
      return {
        ...EMPTY,
        headline,
        body: `${why ?? ""} ${question ? QUESTION.ask : SHOW.lead}`.trim(),
        primary: question ? QUESTION.yes : SHOW.button,
        link: question ? QUESTION.no : SHOW.later,
        explainRuleId: card.ruleId,
      };
    }
    case "permission":
      return { ...EMPTY, headline, body: PERMISSION.body, primary: PERMISSION.button, link: PERMISSION.notNow };
    case "lock":
      return { ...EMPTY, headline, body: PAYWALL.body, list: card.ruleIds.map((id) => guidedFor(id).headline), primary: PAYWALL.buy, link: PAYWALL.notNow, licence: true };
    case "rescan":
      return { ...EMPTY, headline, primary: FIX.checkAgain };
    case "change_ai":
      return { ...EMPTY, headline, primary: CHAT.changeAiPrimary };
    case "watch":
      if (item === null) return { ...EMPTY, headline, body: CHAT.watchBody, primary: WATCH.checkNow };
      return {
        ...EMPTY,
        headline,
        body: facts.noticedTime === null ? CHAT.noticedNoTime : FISHY.noticed.body.replace("{time}", facts.noticedTime),
        meta: WATCH.sourceAct,
        primary: FISHY.noticed.primary,
        link: FISHY.noticed.link,
        urgent: true,
      };
    case "question":
      return { ...EMPTY, headline, body: why, primary: QUESTION.yes, link: QUESTION.no, explainRuleId: card.ruleId };
    case "accept":
      return { ...EMPTY, headline, body: CHAT.acceptBody, primary: CHAT.chips.leaveAlone, link: ACCEPT.primary };
    case "snooze":
      return { ...EMPTY, headline, body: why, primary: FIX.later };
    case "details":
      return { ...EMPTY, headline, body: why, primary: END.details };
    case "write_up":
      return { ...EMPTY, headline, body: ACTIVITY.writeUp.lead, primary: ACTIVITY.writeUp.copy };
    case "explain":
      return { ...EMPTY, headline, body: why, primary: null, explainRuleId: card.ruleId };
  }
}
