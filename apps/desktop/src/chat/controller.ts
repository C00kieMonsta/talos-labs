import type { Dispatch } from "react";
import type { Allowed, ChatCall, ChatCardKind, ChatEventInput, ChatInput, ChatIntent, ChatOutcome, ChatResult, ExplainerContext, ExplainerPort, GuidedStep, IntentKind, RemindWhen, RuleId, ScanReport, WatchState, WriteUpStrings } from "@talos/core";
import { CHAT_LIMITS, askWhyQuestion, buildWriteUp, cardsFromRelated, clampChatHistory, clampChatQuestion, historyFor, intentsFor, lockedFor, stillAllowed, toAllowedInput, whatIfFor } from "@talos/core";
import { GRADE_LABELS } from "../app/labels";
import type { Route } from "../app/router";
import { rulePasses } from "../scan/machine";
import type { ChatBridge, ChatSettled, DoneRow } from "../guided/state";
import { ACTIVITY, CHAT, END, LATER_FLASH, PAYWALL, QUESTION, SHOW, WATCH, WATCH_ON, failureCopy } from "../guided/copy";
import { guidedFor, paneFor, ruleIdsOf, severityFor } from "../guided/plan";
import { acceptMatches } from "./accept-grammar";
import { cardFor, seedForStep, severityOf, writeUpCard } from "./cards";
import { chipLabel } from "./chips";
import { grammarMatch } from "./grammar";
import type { GrammarContext, GrammarMatch } from "./grammar";
import { machineText } from "./guard";
import type { ChatHandlers } from "./handlers";
import type { CardFailure, CardSeed, ChatAction, ChatMessage, ChatState, ChipId } from "./state";
import { walkChecklist } from "./walk";

type Card = Extract<ChatMessage, { kind: "card" }>;
type Person = Extract<ChatMessage, { kind: "person" }>;

/** The intent a step-less card stands for, re-checked against the live allow-lists at the tap. */
const INTENT_FOR: Partial<Record<ChatCardKind, IntentKind>> = { accept: "accept_rule", snooze: "snooze_rule", details: "open_details", explain: "explain_rule" };

/** What the controller reaches beyond the reducer: the bridge, the scan, the AI and the other controllers. */
export interface ControllerDeps {
  readonly dispatch: Dispatch<ChatAction>;
  getState(): ChatState;
  readonly bridge: ChatBridge;
  now(): number;
  nowIso(): string;
  report(): ScanReport | null;
  allowed(): Allowed;
  licensed(): boolean;
  watchOn(): boolean;
  context(): ExplainerContext | null;
  explainer(): Promise<ExplainerPort>;
  explainRunning(): boolean;
  watchState(): WatchState | null;
  provider(): "remote" | "on_device";
  /** The provider's limit time, for a failed turn. */
  until(): string | null;
  navigate(route: Route): void;
  openConnect(): void;
  openFishy(): void;
  openBuyPage(): void;
  acknowledge(signalId: WatchState["items"][number]["signalId"]): void;
  /** "Check now" on the watch card; the hook resolves the row. */
  checkWatch(cardId: string): void;
  /** The hook schedules the walk's next card after a tick. */
  scheduleWalk(): void;
  /** The hook owns the abort controller: a new one per turn, aborted on Stop. */
  abort(): void;
  signal(): AbortSignal;
  onPartial(turnId: string, text: string): void;
  onFailure(reason: string): void;
  /** "Copy it" on the write-up card; false when the clipboard refused. */
  clipboard(text: string): Promise<boolean>;
  /** Today, already formatted for the write-up's title. */
  date(): string;
}

const ALL_CHIPS: readonly ChipId[] = ["do_them_all", "fix_what_you_can", "what_is_urgent", "what_first", "whats_next", "show_list", "check_again", "leave_alone", "why", "try_again", "send_again", "remind_tomorrow", "remind_sunday", "what_if", "write_up"];

/** The three app-answer kinds the model may name (DESIGN-AGENT 2f, 2g, 2h); they run after the cards land, in the model's order. */
const PENDING_KINDS: readonly IntentKind[] = ["remind_rule", "what_if", "write_up"];
/** 2i: a card whose primary changes the Mac is drawn live whatever the model's order. */
const MAC_CHANGING: readonly ChatCardKind[] = ["fix", "batch", "show"];

/** The chip whose label the typed text equals, case-insensitive; null otherwise. */
export function chipFromText(text: string): ChipId | null {
  const wanted = text.trim().toLowerCase();
  return ALL_CHIPS.find((id) => chipLabel(id).toLowerCase() === wanted) ?? null;
}

function cardById(state: ChatState, cardId: string): Card | null {
  return state.messages.find((m): m is Card => m.kind === "card" && m.id === cardId) ?? null;
}

function newestCard(state: ChatState, where: (card: Card) => boolean = () => true): Card | null {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m?.kind === "card" && where(m)) return m;
  }
  return null;
}

/** The card the person just declined: resolved as snoozed, naming one rule. */
const declined = (c: Card) => c.state === "resolved" && c.outcome === "snoozed" && c.card.ruleId !== null;
const namesRule = (c: Card) => c.card.ruleId !== null;

/** The newest turn the person typed; chip echoes are labels, not questions. */
function lastTyped(state: ChatState): Person | null {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m?.kind === "person" && m.source === "typed") return m;
  }
  return null;
}

/** The result line and rows of a settled card. */
export function settledLine(settled: ChatSettled): { line: string; rows: readonly DoneRow[]; failure: CardFailure | null } {
  const { state } = settled;
  if (state.kind === "done") return { line: state.line, rows: state.rows, failure: null };
  if (state.kind === "expired") return { line: SHOW.expiredNotice, rows: [], failure: null };
  return { line: "", rows: [], failure: { error: state.error, batch: state.batch } };
}

/** The controller: every handler of the transcript plus what the hook calls back into after the scan machine moves. */
export interface ChatController extends ChatHandlers {
  /** A settled fix, batch, permission or watcher for the working card: the result line, then the end or lock card. */
  settled(settled: ChatSettled): void;
  /** The lock card once per check-up, else nothing; called after every settled card. */
  afterSettle(): void;
  /** The walk's next card after a tick; true when a card landed. */
  walkNext(): boolean;
  /** The end message when no undone step remains. */
  endIfDone(): void;
  /** The opening's cards and rows for "Fix what you can". */
  fixWhatYouCan(): void;
  /** A watch act-now message landed; the hook already dispatched it. */
  resend(): void;
}

const WRITE_UP_STRINGS: Omit<WriteUpStrings, "quote"> = {
  title: ACTIVITY.writeUp.title,
  score: ACTIVITY.writeUp.score,
  fixed: ACTIVITY.writeUp.fixed,
  todo: ACTIVITY.writeUp.todo,
  later: ACTIVITY.writeUp.later,
  left: ACTIVITY.writeUp.left,
  watch: ACTIVITY.writeUp.watch,
  watchWords: { calm: WATCH.calm, look: WATCH.look, act: WATCH.act },
  grade: GRADE_LABELS,
};

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

export function createChatController(deps: ControllerDeps): ChatController {
  const { dispatch, getState, bridge } = deps;
  const at = () => deps.now();
  const events: { kind: ChatEventInput["kind"]; ruleIds: readonly RuleId[]; turn: number }[] = [];
  let turns = 0;
  // The paywall step is the lock card's business: it lands through lock_shown only, never as a step card.
  const undoneSteps = () => bridge.undone().filter((s) => s.kind !== "paywall");
  const nextStep = () => undoneSteps()[0] ?? null;
  const atEnd = () => undoneSteps().length === 0;

  const note = (kind: ChatEventInput["kind"], ruleIds: readonly RuleId[]) => {
    events.unshift({ kind, ruleIds, turn: turns });
    if (events.length > CHAT_LIMITS.maxEvents) events.length = CHAT_LIMITS.maxEvents;
  };

  const seedsForIntents = (result: ChatResult, allowed: Allowed): { cards: CardSeed[]; related: CardSeed[]; pending: ChatIntent[] } => {
    const plan = bridge.plan;
    if (plan === null) return { cards: [], related: [], pending: [] };
    const cards: CardSeed[] = [];
    const pending: ChatIntent[] = [];
    for (const intent of intentsFor(result, allowed)) {
      if (PENDING_KINDS.includes(intent.kind)) {
        if (stillAllowed(intent, allowed)) pending.push(intent);
        continue;
      }
      const seed = cardFor(intent, plan, allowed);
      if (seed !== null) cards.push(seed);
    }
    // 2i: the Mac-changing card is the live one; the model's order holds among the rest.
    cards.sort((a, b) => Number(MAC_CHANGING.includes(b.card.kind)) - Number(MAC_CHANGING.includes(a.card.kind)));
    const named = new Set(cards.flatMap((c) => c.card.ruleIds));
    const related: CardSeed[] = [];
    for (const intent of cardsFromRelated(result.relatedRuleIds, allowed)) {
      if (intent.ruleId === null || named.has(intent.ruleId)) continue;
      related.push({ card: { kind: "details", ruleId: intent.ruleId, ruleIds: [intent.ruleId], severity: severityOf([intent.ruleId]) }, step: null, item: null });
    }
    return { cards, related, pending };
  };

  const lockedMeta = (locked: readonly RuleId[]): string | null => (locked.length === 0 ? null : locked.length === 1 ? CHAT.moreLockedOne : CHAT.moreLocked.replace("{n}", String(locked.length)));

  const input = (question: string): ChatInput | null => {
    const context = deps.context();
    const plan = bridge.plan;
    if (context === null || plan === null) return null;
    const watch = deps.watchState();
    const undone = bridge.undone();
    const stepRuleIds = undone.flatMap((s) => (s.kind === "batch" ? [s.ruleIds[0] ?? null] : s.kind === "fix" || s.kind === "show" ? [s.ruleId] : [])).filter((id): id is RuleId => id !== null).slice(0, CHAT_LIMITS.maxPlanIds);
    const lastCheck = watch?.lastCheckAt ?? null;
    return {
      context,
      history: clampChatHistory(historyFor(getState().messages), deps.provider()),
      question: clampChatQuestion(question),
      plan: { stepRuleIds, fixed: bridge.fixed, later: plan.later, accepted: plan.accepted, leftAlone: plan.leftAlone },
      allowed: toAllowedInput(deps.allowed()),
      events: events.map((e) => ({ kind: e.kind, ruleIds: e.ruleIds, turnsAgo: turns - e.turn })),
      watch: {
        enabled: watch?.enabled === true && watch.licensed,
        rating: watch?.rating ?? "calm",
        lastCheckMinutesAgo: lastCheck === null ? null : Math.max(0, Math.round((deps.now() - Date.parse(lastCheck)) / 60_000)),
        items: (watch?.items ?? []).slice(0, CHAT_LIMITS.maxWatchItems).map((item) => ({ signalId: item.signalId, kind: item.kind, change: item.change })),
      },
    };
  };

  const turn = async (text: string) => {
    const built = input(text);
    if (built === null) return;
    turns += 1;
    const turnId = `turn-${turns}`;
    dispatch({ type: "person_sent", at: at(), text, turnId });
    const allowed = deps.allowed();
    const plan = bridge.plan;
    const call: ChatCall = { input: built, allowed, locked: plan === null ? [] : lockedFor(plan, { freeFixes: plan.freeFixes, licensed: deps.licensed() }) };
    const signal = deps.signal();
    let result: Awaited<ReturnType<ExplainerPort["chat"]>>;
    try {
      const explainer = await deps.explainer();
      result = await explainer.chat(call, { signal, onPartial: (partial) => typeof partial.reply === "string" && deps.onPartial(turnId, partial.reply) });
    } catch {
      result = { ok: false, reason: "unknown" };
    }
    if (signal.aborted) return;
    if (!result.ok) {
      dispatch({ type: "model_failed", at: at(), turnId, reason: result.reason, until: deps.until() });
      deps.onFailure(result.reason);
      return;
    }
    const live = deps.allowed();
    const { cards, related, pending } = seedsForIntents(result.value, live);
    dispatch({ type: "model_ready", at: at(), turnId, result: result.value, cards, related, lockedMeta: lockedMeta(result.value.locked) });
    for (const intent of pending) pendingIntent(intent);
  };

  const answer = (cards: readonly CardSeed[], headline: string | null = null, body: string | null = null, extra: { walking?: boolean; rowsOnly?: boolean } = {}) =>
    dispatch({ type: "app_answered", at: at(), answer: { headline, body, label: "answer", cards, ...extra } });

  const endIfDone = () => {
    if (!atEnd() || bridge.plan === null) return;
    // The fresh plan folds in this check-up's snoozes and accepts, as the end screen's does.
    const plan = bridge.endPlan() ?? bridge.plan;
    const fixed = bridge.fixed.length;
    const nothingOpen = plan.later.length === 0 && plan.locked.length === 0;
    const chosen = plan.accepted.length > 0;
    const allDone = fixed > 0 && nothingOpen;
    const nothing = fixed === 0 && nothingOpen;
    const title = allDone ? (chosen ? END.partial : END.allDone) : nothing ? (chosen ? END.nothingLeft : END.nothing) : END.partial;
    const groups = [
      { label: END.waiting, rows: plan.later.map((id) => ({ key: id, text: guidedFor(id).headline, icon: "pending" as const })) },
      { label: END.chosen, rows: plan.accepted.map((id) => ({ key: id, text: guidedFor(id).headline, icon: "none" as const })) },
    ].filter((g) => g.rows.length > 0);
    dispatch({ type: "end_reached", at: at(), title, body: deps.watchOn() ? WATCH_ON.nextTime : END.nextTime, groups, brief: null });
    bridge.setWalking(false);
    dispatch({ type: "walk_ended" });
  };

  const afterSettle = () => {
    const state = getState();
    const plan = bridge.plan;
    if (plan !== null && !deps.licensed() && plan.locked.length > 0 && !state.lockShown && !bridge.doneStepIds.includes("paywall")) {
      const freeLeft = bridge.undone().some((s) => s.kind === "fix" || s.kind === "batch" || s.kind === "show");
      if (!freeLeft) dispatch({ type: "lock_shown", at: at(), ruleIds: plan.locked });
    }
    endIfDone();
  };

  const result = (cardId: string, outcome: ChatOutcome, line: string, rows: readonly DoneRow[] = [], failure: CardFailure | null = null) => {
    const done = bridge.doneStepIds;
    const settledRuleIds = (bridge.plan?.steps ?? []).filter((s) => done.includes(s.id)).flatMap(ruleIdsOf);
    dispatch({ type: "card_result", at: at(), cardId, outcome, line, rows, failure, settledRuleIds });
  };

  const settled = (s: ChatSettled, card: string | null = null) => {
    const state = getState();
    const cardId = card ?? state.working;
    if (cardId === null) return;
    const read = settledLine(s);
    const ruleIds = ruleIdsOf(s.step);
    if (s.outcome === "fixed" || s.outcome === "watch_passed") note("fixed", ruleIds);
    else if (s.outcome === "did_not_change") note("did_not_change", ruleIds);
    result(cardId, s.outcome, read.line, read.rows, read.failure);
    walkCursor = s.step.id;
    if (read.failure === null && getState().walking) deps.scheduleWalk();
    afterSettle();
  };

  /* AGENT part B region (docs/DESIGN-AGENT.md 2c, 2f, 2g, 2h, section 3): zero-call app answers and the two gated lines. */
  let walkCursor: string | null = null;

  const stepForRule = (ruleId: RuleId): GuidedStep | null => bridge.plan?.steps.find((s) => s.kind !== "paywall" && ruleIdsOf(s).includes(ruleId)) ?? null;

  /** The reminder replaces the "Do this later" snooze; an idle card for the step collapses to the line (2f). */
  const remind = (step: GuidedStep, when: RemindWhen) => {
    const ruleIds = ruleIdsOf(step);
    const first = ruleIds[0];
    if (first === undefined) return;
    const open = newestCard(getState(), (c) => c.step?.id === step.id && c.state === "idle");
    bridge.remind(step, when);
    note("snoozed", ruleIds);
    const chipId: ChipId = when === "tomorrow" ? "remind_tomorrow" : "remind_sunday";
    dispatch({ type: "app_answered", at: at(), answer: { headline: chipLabel(chipId), body: ACTIVITY.remind[when].replace("{headline}", guidedFor(first).headline), label: "remind", cards: [] } });
    if (open !== null) result(open.id, "snoozed", CHAT.ok);
    afterSettle();
  };

  /** Answered from the plan's points, zero calls: the risk, the cost, and the third line for a critical rule (2h). */
  const whatIf = (ruleId: RuleId) => {
    const report = deps.report();
    const plan = bridge.plan;
    const info = report === null ? null : whatIfFor(report, ruleId);
    const lines = [guidedFor(ruleId).why];
    if (info !== null) lines.push(ACTIVITY.whatIf.cost.replace("{p}", String(info.points)));
    if (severityFor(ruleId) === "critical") lines.push(ACTIVITY.whatIf.critical);
    const seed = plan === null ? null : cardFor({ kind: "what_if", ruleId, signalId: null, when: null }, plan, deps.allowed());
    dispatch({ type: "app_answered", at: at(), answer: { headline: chipLabel("what_if"), body: lines.join("\n"), label: "what_if", cards: seed === null ? [] : [seed] } });
  };

  const watchWord = (): "calm" | "look" | "act" | null => {
    if (!deps.watchOn()) return null;
    const rating = deps.watchState()?.rating ?? "calm";
    return rating === "act_now" ? "act" : rating === "keep_an_eye" ? "look" : "calm";
  };

  /** Authored text from the catalogue and the plan, never model text; the brief quote waits on last-brief.json (2g). */
  const writeUp = () => {
    const report = deps.report();
    const plan = bridge.endPlan() ?? bridge.plan;
    if (report === null || plan === null) return;
    const fixed = bridge.fixed.filter((id) => rulePasses(report, id));
    const { text } = buildWriteUp({ plan, report, fixed, watch: watchWord(), brief: null, date: deps.date() }, { ...WRITE_UP_STRINGS, quote: null });
    dispatch({ type: "card_appended", at: at(), seed: writeUpCard(text) });
  };

  /** Section 3: the two kinds whose ports do not exist yet answer an honest line; off or unlicensed, the watch's own refusals. */
  const gated = (kind: "investigate" | "close_watch") => {
    const look = kind === "investigate";
    const notice = (text: string, wayOut: Extract<ChatAction, { type: "notice_added" }>["wayOut"] = null) => dispatch({ type: "notice_added", at: at(), text, wayOut });
    if (deps.watchOn()) notice(look ? ACTIVITY.refuse.lookNotYet : ACTIVITY.refuse.closerNotYet);
    else if (!deps.licensed()) notice(look ? ACTIVITY.refuse.full_version : ACTIVITY.refuse.full_version_closer);
    else notice(ACTIVITY.refuse.watch_off, { kind: "link", label: ACTIVITY.links.settings, route: { name: "settings" } });
  };

  const agentTurn = (match: GrammarMatch) => {
    switch (match.kind) {
      case "remind": {
        const step = stepForRule(match.ruleId);
        if (step !== null) remind(step, match.when);
        return;
      }
      case "what_if":
        whatIf(match.ruleId);
        return;
      case "write_up":
        writeUp();
        return;
      case "investigate":
      case "close_watch":
        gated(match.kind);
        return;
    }
  };

  /** A model-named app answer, run after its cards landed (2i). */
  const pendingIntent = (intent: ChatIntent) => {
    if (intent.kind === "remind_rule" && intent.ruleId !== null) {
      const step = stepForRule(intent.ruleId);
      if (step !== null) remind(step, intent.when ?? "tomorrow");
    } else if (intent.kind === "what_if" && intent.ruleId !== null) whatIf(intent.ruleId);
    else if (intent.kind === "write_up") writeUp();
  };

  const grammarContext = (): GrammarContext => ({ undone: undoneSteps().flatMap(ruleIdsOf), failing: deps.allowed().whatIf, newestRuleId: newestCard(getState())?.card.ruleId ?? null });

  /** A tapped checklist row: its row steps up, or its step lands as the live card out of order (2c). */
  const promoteStep = (stepId: string) => {
    const state = getState();
    if (state.working !== null) return;
    const row = state.messages.find((m) => m.kind === "row" && m.seed.step?.id === stepId);
    if (row !== undefined) {
      dispatch({ type: "row_promoted", at: at(), rowId: row.id });
      return;
    }
    const step = undoneSteps().find((s) => s.id === stepId);
    if (step === undefined || newestCard(state, (c) => c.step?.id === stepId && c.state === "idle" && c.live) !== null) return;
    dispatch({ type: "card_appended", at: at(), seed: seedForStep(step) });
  };

  const walkNext = (): boolean => {
    const state = getState();
    if (!state.walking || state.working !== null) return false;
    // The walk continues from the row after the one resolved (2c), then wraps to the first undone.
    const steps = bridge.plan?.steps ?? [];
    const cursor = walkCursor === null ? -1 : steps.findIndex((s) => s.id === walkCursor);
    const undone = undoneSteps();
    const next = undone.find((s) => steps.findIndex((p) => p.id === s.id) > cursor) ?? undone[0] ?? null;
    if (next === null) {
      endIfDone();
      return false;
    }
    const row = state.messages.find((m) => m.kind === "row" && m.seed.step?.id === next.id);
    if (row !== undefined) dispatch({ type: "row_promoted", at: at(), rowId: row.id });
    else dispatch({ type: "card_appended", at: at(), seed: seedForStep(next) });
    return true;
  };

  const fixWhatYouCan = () => {
    const undone = bridge.undone();
    const batch = undone.find((s) => s.kind === "batch");
    const fixes = undone.filter((s) => s.kind === "fix");
    const seeds = [...(batch === undefined ? [] : [batch]), ...fixes].map(seedForStep);
    answer(seeds);
  };

  const urgentStep = (): GuidedStep | null => {
    const report = deps.report();
    const undone = bridge.undone();
    let best: { step: GuidedStep; points: number } | null = null;
    for (const step of undone) {
      const severity = severityOf(ruleIdsOf(step));
      if (severity !== "critical" && severity !== "high") continue;
      const points = ruleIdsOf(step).reduce((sum, id) => sum + (report?.results.find((r) => r.ruleId === id)?.points ?? 0), 0);
      if (best === null || points > best.points) best = { step, points };
    }
    return best?.step ?? null;
  };

  // "Why?" asks about a rule; the same text the watch window drafts, so the auto-send match holds.
  const whyFor = (card: Card | null): string | null => (card === null || card.card.ruleId === null ? null : askWhyQuestion(guidedFor(card.card.ruleId).headline));

  const send = (text: string): boolean => {
    const state = getState();
    const trimmed = text.trim();
    if (trimmed.length === 0 || state.stream.kind !== "idle") return false;
    if (deps.explainRunning()) {
      dispatch({ type: "guard_refused", at: at(), text: CHAT.busyExplain });
      return false;
    }
    if (machineText(trimmed)) {
      dispatch({ type: "guard_refused", at: at(), text: CHAT.guard });
      return false;
    }
    const chipId = chipFromText(trimmed);
    if (chipId !== null) {
      chip(chipId);
      return true;
    }
    const plan = bridge.plan;
    const matches = plan === null ? [] : acceptMatches(trimmed, plan, bridge.doneStepIds);
    if (matches.length > 0) {
      dispatch({ type: "chip_pressed", at: at(), chipId: "leave_alone", text: trimmed });
      answer(matches.map((id) => ({ card: { kind: "accept", ruleId: id, ruleIds: [id], severity: severityOf([id]) }, step: null, item: null })));
      return true;
    }
    // The agent grammars route the typed forms before any call; a near-miss goes to the model.
    const match = plan === null ? null : grammarMatch(trimmed, grammarContext());
    if (match !== null) {
      dispatch({ type: "chip_pressed", at: at(), text: trimmed });
      agentTurn(match);
      return true;
    }
    void turn(trimmed);
    return true;
  };

  const resend = () => {
    const last = lastTyped(getState());
    if (last !== null) send(last.text);
  };

  const chip = (id: ChipId) => {
    const state = getState();
    if (state.stream.kind !== "idle") return;
    const echo = (chipId: ChipId) => dispatch({ type: "chip_pressed", at: at(), chipId, text: chipLabel(chipId) });
    switch (id) {
      case "do_them_all": {
        const next = nextStep();
        echo(id);
        if (next === null) {
          endIfDone();
          return;
        }
        bridge.setWalking(true);
        walkCursor = null;
        dispatch({ type: "app_answered", at: at(), answer: { headline: chipLabel(id), body: ACTIVITY.plan.lead, label: "walk", checklist: walkChecklist(undoneSteps()), cards: [seedForStep(next)], walking: true } });
        return;
      }
      case "remind_tomorrow":
      case "remind_sunday": {
        // The card just declined, else the newest card naming a rule.
        const target = newestCard(state, declined) ?? newestCard(state, namesRule);
        echo(id);
        const step = target?.card.ruleId === null || target === null ? null : stepForRule(target.card.ruleId);
        if (step !== null) remind(step, id === "remind_tomorrow" ? "tomorrow" : "sunday");
        return;
      }
      case "what_if": {
        const ruleId = newestCard(state, namesRule)?.card.ruleId ?? null;
        echo(id);
        if (ruleId !== null) whatIf(ruleId);
        return;
      }
      case "write_up":
        echo(id);
        writeUp();
        return;
      case "fix_what_you_can":
        echo(id);
        fixWhatYouCan();
        return;
      case "what_is_urgent": {
        const step = urgentStep();
        echo(id);
        if (step === null) return;
        const seed = seedForStep(step);
        const id0 = ruleIdsOf(step)[0];
        const g = id0 === undefined ? null : guidedFor(id0);
        answer([seed], g === null ? CHAT.urgentLead : `${CHAT.urgentLead} ${g.headline}.`, g === null ? null : g.why);
        return;
      }
      case "what_first": {
        const next = nextStep();
        echo(id);
        if (next !== null) answer([seedForStep(next)], CHAT.firstLead);
        return;
      }
      case "whats_next": {
        const next = nextStep();
        echo(id);
        if (next === null) endIfDone();
        else answer([seedForStep(next)], CHAT.nextLead);
        return;
      }
      case "show_list": {
        // The Plan screen's list: one row per rule of each fix, batch and show step; the locked count is a line, not a row.
        echo(id);
        const rows: CardSeed[] = [];
        for (const step of undoneSteps()) {
          if (step.kind === "permission") continue;
          const seed = seedForStep(step);
          for (const ruleId of ruleIdsOf(step)) rows.push({ ...seed, rowHeadline: guidedFor(ruleId).headline });
        }
        const plan = bridge.plan;
        answer(rows, CHAT.list, plan === null || deps.licensed() ? null : lockedMeta(plan.locked), { rowsOnly: true });
        return;
      }
      case "check_again":
        echo(id);
        note("rescanned", []);
        bridge.rescan();
        return;
      case "leave_alone": {
        const card = newestCard(state);
        const ruleId = card?.card.ruleId ?? null;
        echo(id);
        if (ruleId === null) return;
        answer([{ card: { kind: "accept", ruleId, ruleIds: [ruleId], severity: severityOf([ruleId]) }, step: null, item: null }]);
        return;
      }
      case "why": {
        const text = whyFor(newestCard(state));
        if (text !== null) void turn(text);
        return;
      }
      case "try_again":
      case "send_again":
        resend();
        return;
    }
  };

  const startStep = (card: Card, step: GuidedStep, passphrase?: string) => {
    if (bridge.doneStepIds.includes(step.id)) {
      const report = deps.report();
      const passes = report !== null && ruleIdsOf(step).every((id) => report.results.find((r) => r.ruleId === id)?.status === "pass");
      dispatch({ type: "card_stale", at: at(), cardId: card.id, line: passes ? CHAT.staleDone : CHAT.staleWaiting });
      return;
    }
    if (getState().working !== null) return;
    dispatch({ type: "card_started", cardId: card.id });
    bridge.run(step, passphrase);
  };

  const checkAgain = (cardId: string) => {
    const card = cardById(getState(), cardId);
    if (card?.step === undefined || card.step === null) return;
    // A failed card is not the working one, so the recheck names the card it settles.
    void bridge.checkAgain(card.step).then((s) => {
      if (s !== null) settled(s, cardId);
    });
  };

  const primary = (cardId: string, passphrase?: string) => {
    const state = getState();
    const card = cardById(state, cardId);
    if (card === null || (card.state !== "idle" && card.state !== "failed")) return;
    const { step } = card;
    // A failed card's primary reads the failure table: "Check again" is a free recheck, "Next" leaves the rules alone, the rest run again.
    if (card.state === "failed" && card.failure !== null && step !== null) {
      const copy = failureCopy(card.failure.error, card.failure.batch, card.card.ruleId !== null && paneFor(card.card.ruleId) !== null, deps.watchOn());
      if (copy.primary === "check_again") {
        checkAgain(cardId);
        return;
      }
      if (copy.primary === "next") {
        bridge.leaveAlone(step);
        result(cardId, "stale", CHAT.ok);
        afterSettle();
        return;
      }
    }
    // A step-less card is re-checked at the tap: its item may have left the allow-lists since the reply landed.
    const intent = INTENT_FOR[card.card.kind];
    if (intent !== undefined && !stillAllowed({ kind: intent, ruleId: card.card.ruleId }, deps.allowed())) {
      dispatch({ type: "card_stale", at: at(), cardId: card.id, line: CHAT.staleDone });
      return;
    }
    switch (card.card.kind) {
      case "fix":
      case "batch":
      case "show":
      case "permission":
      case "question":
        if (step !== null) startStep(card, step, passphrase);
        return;
      case "lock":
        deps.openBuyPage();
        return;
      case "rescan":
        note("rescanned", []);
        bridge.rescan();
        return;
      case "change_ai":
        deps.openConnect();
        return;
      case "watch":
        if (card.item !== null) deps.openFishy();
        else deps.checkWatch(cardId);
        return;
      case "accept":
        if (card.card.ruleId !== null) {
          bridge.accept([card.card.ruleId]);
          note("accepted", [card.card.ruleId]);
          result(cardId, "accepted", CHAT.accepted);
          afterSettle();
        }
        return;
      case "snooze":
        if (card.card.ruleId !== null) {
          const target = bridge.plan?.steps.find((s) => ruleIdsOf(s).includes(card.card.ruleId as RuleId)) ?? null;
          if (target !== null) bridge.later(target);
          note("snoozed", [card.card.ruleId]);
          result(cardId, "snoozed", LATER_FLASH);
          afterSettle();
        }
        return;
      case "details":
        if (card.card.ruleId !== null) deps.navigate({ name: "finding", ruleId: card.card.ruleId });
        return;
      case "write_up":
        if (card.writeUpText !== null) {
          void deps.clipboard(card.writeUpText).then((ok) => {
            if (ok) {
              dispatch({ type: "card_copied", at: at(), cardId });
              dispatch({ type: "explain_state", text: ACTIVITY.writeUp.copied });
            } else dispatch({ type: "notice_added", at: at(), text: ACTIVITY.writeUp.copyFailed, wayOut: null });
          });
        }
        return;
      case "explain":
        return;
    }
  };

  const link = (cardId: string) => {
    const state = getState();
    const card = cardById(state, cardId);
    if (card === null || (card.state !== "idle" && card.state !== "failed")) return;
    const { step } = card;
    switch (card.card.kind) {
      case "fix":
      case "batch":
      case "permission": {
        if (step === null) return;
        const asked = bridge.later(step);
        note("snoozed", ruleIdsOf(step));
        result(cardId, "snoozed", step.kind === "permission" ? CHAT.ok : LATER_FLASH);
        if (asked.length > 0) answer(asked.map((id) => ({ card: { kind: "accept", ruleId: id, ruleIds: [id], severity: severityOf([id]) }, step: null, item: null })));
        afterSettle();
        return;
      }
      case "show":
      case "question": {
        if (step === null) return;
        if (step.kind === "show" && step.question !== null) {
          bridge.answerNo(step);
          note("snoozed", [step.ruleId]);
          result(cardId, "snoozed", QUESTION.flash);
        } else {
          const asked = bridge.later(step);
          note("snoozed", ruleIdsOf(step));
          result(cardId, "snoozed", LATER_FLASH);
          if (asked.length > 0) answer(asked.map((id) => ({ card: { kind: "accept", ruleId: id, ruleIds: [id], severity: severityOf([id]) }, step: null, item: null })));
        }
        afterSettle();
        return;
      }
      case "lock":
        bridge.snoozePaywall();
        dispatch({ type: "lock_dismissed" });
        return;
      case "watch":
        if (card.item !== null) deps.acknowledge(card.item.signalId);
        result(cardId, "snoozed", CHAT.ok);
        return;
      case "accept":
        result(cardId, "stale", CHAT.ok);
        return;
      case "rescan":
      case "change_ai":
      case "snooze":
      case "details":
      case "explain":
      case "write_up":
        return;
    }
  };

  const licenceAccepted = (cardId: string) => {
    const steps = bridge.unlock();
    result(cardId, "unlocked", PAYWALL.thanks);
    if (steps.length > 0) answer(steps.map(seedForStep));
  };

  return {
    send: (text) => send(text),
    chip,
    primary,
    link,
    checkAgain,
    promote: (rowId) => dispatch({ type: "row_promoted", at: at(), rowId }),
    promoteStep,
    stop: () => {
      const state = getState();
      if (state.stream.kind === "idle") return;
      deps.abort();
      dispatch({ type: "stopped", at: at(), turnId: state.stream.turnId });
    },
    licenceAccepted,
    navigate: deps.navigate,
    draftConsumed: () => dispatch({ type: "draft_consumed" }),
    explainState: (text) => dispatch({ type: "explain_state", text }),
    settled: (s) => settled(s),
    afterSettle,
    walkNext,
    endIfDone,
    fixWhatYouCan,
    resend,
  };
}

/** The things-count line of a batch result, for the hook's "Done. 3 things fixed." fallback. */
export function fixedLine(n: number): string {
  return `Done. ${things(n)} fixed.`;
}
