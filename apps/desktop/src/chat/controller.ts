import type { Dispatch } from "react";
import type { Allowed, ChatCall, ChatEventInput, ChatInput, ChatOutcome, ChatResult, ExplainerContext, ExplainerPort, GuidedStep, RuleId, ScanReport, WatchState } from "@talos/core";
import { CHAT_LIMITS, cardsFromRelated, clampChatHistory, clampChatQuestion, historyFor, intentsFor, lockedFor, toAllowedInput } from "@talos/core";
import type { Route } from "../app/router";
import type { ChatBridge, ChatSettled, DoneRow } from "../guided/state";
import { CHAT, END, LATER_FLASH, PAYWALL, QUESTION, SHOW, WATCH_ON, failureCopy } from "../guided/copy";
import { guidedFor, paneFor, ruleIdsOf } from "../guided/plan";
import { acceptMatches } from "./accept-grammar";
import { cardFor, cardHeadline, lowerFirst, seedForStep, severityOf } from "./cards";
import { chipLabel } from "./chips";
import { machineText } from "./guard";
import type { ChatHandlers } from "./handlers";
import type { CardFailure, CardSeed, ChatAction, ChatMessage, ChatState, ChipId } from "./state";

type Card = Extract<ChatMessage, { kind: "card" }>;

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
}

const ALL_CHIPS: readonly ChipId[] = ["do_them_all", "fix_what_you_can", "what_is_urgent", "what_first", "whats_next", "show_list", "check_again", "leave_alone", "why", "try_again", "send_again"];

/** The chip whose label the typed text equals, case-insensitive; null otherwise. */
export function chipFromText(text: string): ChipId | null {
  const wanted = text.trim().toLowerCase();
  return ALL_CHIPS.find((id) => chipLabel(id).toLowerCase() === wanted) ?? null;
}

function cardById(state: ChatState, cardId: string): Card | null {
  return state.messages.find((m): m is Card => m.kind === "card" && m.id === cardId) ?? null;
}

function newestCard(state: ChatState): Card | null {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m?.kind === "card") return m;
  }
  return null;
}

function lastPersonText(state: ChatState): string | null {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m?.kind === "person") return m.text;
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
  /** The walk's next card after a tick. */
  walkNext(): void;
  /** The end message when no undone step remains. */
  endIfDone(): void;
  /** The opening's cards and rows for "Fix what you can". */
  fixWhatYouCan(): void;
  /** A watch act-now message landed; the hook already dispatched it. */
  resend(): void;
}

function things(n: number): string {
  return n === 1 ? "1 thing" : `${n} things`;
}

export function createChatController(deps: ControllerDeps): ChatController {
  const { dispatch, getState, bridge } = deps;
  const at = () => deps.now();
  const events: ChatEventInput[] = [];
  let turns = 0;

  const note = (kind: ChatEventInput["kind"], ruleIds: readonly RuleId[]) => {
    events.unshift({ kind, ruleIds, turnsAgo: 0 });
    if (events.length > CHAT_LIMITS.maxEvents) events.length = CHAT_LIMITS.maxEvents;
  };

  const seedsForIntents = (result: ChatResult, allowed: Allowed): { cards: CardSeed[]; related: CardSeed[] } => {
    const plan = bridge.plan;
    if (plan === null) return { cards: [], related: [] };
    const cards: CardSeed[] = [];
    for (const intent of intentsFor(result, allowed)) {
      const seed = cardFor(intent, plan, allowed);
      if (seed !== null) cards.push(seed);
    }
    const named = new Set(cards.flatMap((c) => c.card.ruleIds));
    const related: CardSeed[] = [];
    for (const intent of cardsFromRelated(result.relatedRuleIds, allowed)) {
      if (intent.ruleId === null || named.has(intent.ruleId)) continue;
      related.push({ card: { kind: "details", ruleId: intent.ruleId, ruleIds: [intent.ruleId], severity: severityOf([intent.ruleId]) }, step: null, item: null });
    }
    return { cards, related };
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
      events: events.map((e, i) => ({ ...e, turnsAgo: Math.min(e.turnsAgo, i + 1) })),
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
    const { cards, related } = seedsForIntents(result.value, live);
    dispatch({ type: "model_ready", at: at(), turnId, result: result.value, cards, related, lockedMeta: lockedMeta(result.value.locked) });
  };

  const answer = (cards: readonly CardSeed[], headline: string | null = null, body: string | null = null, extra: { walking?: boolean; rowsOnly?: boolean } = {}) =>
    dispatch({ type: "app_answered", at: at(), answer: { headline, body, label: "answer", cards, ...extra } });

  const endIfDone = () => {
    if (!bridge.atEnd() || bridge.plan === null) return;
    const plan = bridge.plan;
    const fixed = bridge.fixed.length;
    const title = fixed === 0 ? (plan.later.length === 0 && plan.accepted.length === 0 ? END.allDone : END.partial) : plan.later.length === 0 ? END.allDone : END.partial;
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
      const freeLeft = bridge.undone().some((s) => s.kind === "fix" || s.kind === "batch");
      if (!freeLeft) dispatch({ type: "lock_shown", at: at(), ruleIds: plan.locked });
    }
    endIfDone();
  };

  const result = (cardId: string, outcome: ChatOutcome, line: string, rows: readonly DoneRow[] = [], failure: CardFailure | null = null) => {
    dispatch({ type: "card_result", at: at(), cardId, outcome, line, rows, failure });
  };

  const settled = (s: ChatSettled) => {
    const state = getState();
    const cardId = state.working;
    if (cardId === null) return;
    const read = settledLine(s);
    const ruleIds = ruleIdsOf(s.step);
    if (s.outcome === "fixed" || s.outcome === "watch_passed") note("fixed", ruleIds);
    else if (s.outcome === "did_not_change") note("did_not_change", ruleIds);
    result(cardId, s.outcome, read.line, read.rows, read.failure);
    if (read.failure === null && getState().walking) deps.scheduleWalk();
    afterSettle();
  };

  const walkNext = () => {
    const state = getState();
    if (!state.walking || state.working !== null) return;
    const next = bridge.nextUndone();
    if (next === null) {
      endIfDone();
      return;
    }
    const row = state.messages.find((m) => m.kind === "row" && m.seed.step?.id === next.id);
    if (row !== undefined) dispatch({ type: "row_promoted", at: at(), rowId: row.id });
    else dispatch({ type: "card_appended", at: at(), seed: seedForStep(next) });
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

  const whyFor = (card: Card | null): string | null => {
    const headline = card === null ? null : cardHeadline({ card: card.card, step: card.step, item: card.item });
    return headline === null || headline.length === 0 ? null : CHAT.why.replace("{headline}", lowerFirst(headline.replace(/\.$/, "")));
  };

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
    void turn(trimmed);
    return true;
  };

  const resend = () => {
    const text = lastPersonText(getState());
    if (text !== null) void turn(text);
  };

  const chip = (id: ChipId) => {
    const state = getState();
    if (state.stream.kind !== "idle") return;
    const echo = (chipId: ChipId) => dispatch({ type: "chip_pressed", at: at(), chipId, text: chipLabel(chipId) });
    switch (id) {
      case "do_them_all": {
        const next = bridge.nextUndone();
        echo(id);
        if (next === null) {
          endIfDone();
          return;
        }
        bridge.setWalking(true);
        answer([seedForStep(next)], null, null, { walking: true });
        return;
      }
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
        answer([seed], CHAT.urgentLead, id0 === undefined ? null : `${guidedFor(id0).headline}. ${guidedFor(id0).why}`);
        return;
      }
      case "what_first": {
        const next = bridge.nextUndone();
        echo(id);
        if (next !== null) answer([seedForStep(next)], CHAT.firstLead);
        return;
      }
      case "whats_next": {
        const next = bridge.nextUndone();
        echo(id);
        if (next === null) endIfDone();
        else answer([seedForStep(next)], CHAT.nextLead);
        return;
      }
      case "show_list":
        echo(id);
        answer(bridge.undone().map(seedForStep), CHAT.list, null, { rowsOnly: true });
        return;
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
      dispatch({ type: "card_stale", cardId: card.id, line: passes ? CHAT.staleDone : CHAT.staleWaiting });
      return;
    }
    if (getState().working !== null) return;
    dispatch({ type: "card_started", cardId: card.id });
    bridge.run(step, passphrase);
  };

  const checkAgain = (cardId: string) => {
    const card = cardById(getState(), cardId);
    if (card?.step === undefined || card.step === null) return;
    void bridge.checkAgain(card.step).then((s) => {
      if (s !== null) settled(s);
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
      case "write_up":
        if (card.card.ruleId !== null) deps.navigate({ name: "finding", ruleId: card.card.ruleId });
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
    send: (text) => void send(text),
    chip,
    primary,
    link,
    checkAgain,
    promote: (rowId) => dispatch({ type: "row_promoted", at: at(), rowId }),
    stop: () => {
      const state = getState();
      if (state.stream.kind === "idle") return;
      deps.abort();
      dispatch({ type: "stopped", at: at(), turnId: state.stream.turnId });
    },
    licenceAccepted,
    navigate: deps.navigate,
    draftConsumed: () => dispatch({ type: "draft_consumed" }),
    settled,
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
