import type { AiAvailability, ExplainerFailure, GuidedStep, ReportDiff, RuleId } from "@talos/core";
import { AI_UNAVAILABLE_COPY, formatTime } from "../app/labels";
import { ACTIVITY, CHAT, END, EXPLAIN, FISHY, PLAN, SHOW, WATCH_ON } from "../guided/copy";
import { guidedFor, planText, ruleIdsOf, severityFor } from "../guided/plan";
import { cardHeadline, seedForStep, watchCard } from "./cards";
import { remoteOf, waitingKey } from "./providers";
import { CHAT_ROUTE } from "./routes";
import type { AppAnswer, CardSeed, ChatAction, ChatAppRow, ChatMessage, ChatState, WayOut } from "./state";
import { sameChecklist, syncWalk } from "./walk";

/** The pure reducer of docs/DESIGN-CHAT-UI.md section 4. An event that does not apply is ignored, never thrown. */

type Card = Extract<ChatMessage, { kind: "card" }>;
type Person = Extract<ChatMessage, { kind: "person" }>;
type Row = Extract<ChatMessage, { kind: "row" }>;

function alloc(state: ChatState): [string, ChatState] {
  return [`m${state.seq}`, { ...state, seq: state.seq + 1 }];
}

function announce(state: ChatState, text: string): ChatState {
  return { ...state, announce: { text, seq: state.announce.seq + 1 } };
}

function push(state: ChatState, message: ChatMessage): ChatState {
  return { ...state, messages: [...state.messages, message] };
}

function patch(state: ChatState, id: string, change: (m: ChatMessage) => ChatMessage): ChatState {
  return { ...state, messages: state.messages.map((m) => (m.id === id ? change(m) : m)) };
}

/** A related row reads "Details: ..." so it is not mistaken for a step row. */
function rowHeadline(seed: CardSeed): string {
  if (seed.rowHeadline !== undefined) return seed.rowHeadline;
  const headline = cardHeadline(seed);
  return seed.card.kind === "details" ? CHAT.detailsRow.replace("{headline}", headline) : headline;
}

/** Every idle or failed card becomes a row in place, so one card holds the primary; a failed row retries when promoted. */
function demoteIdle(state: ChatState): ChatState {
  const messages = state.messages.map((m): ChatMessage => {
    if (m.kind !== "card" || (m.state !== "idle" && m.state !== "failed")) return m;
    const seed: CardSeed = { card: m.card, step: m.step, item: m.item, noticedAt: m.noticedAt, ...(m.writeUpText === null ? {} : { text: m.writeUpText }) };
    return { id: m.id, kind: "row", at: m.at, cardId: m.cardId, seed, headline: rowHeadline(seed) };
  });
  return { ...state, messages, live: null };
}

function cardMessage(id: string, at: number, seed: CardSeed, live: boolean): Card {
  return { id, kind: "card", at, cardId: id, card: seed.card, step: seed.step, item: seed.item, noticedAt: seed.noticedAt ?? null, state: "idle", live, outcome: null, result: null, rows: [], failure: null, writeUpText: seed.text ?? null, copiedAt: null };
}

function rowMessage(id: string, at: number, seed: CardSeed): ChatMessage {
  return { id, kind: "row", at, cardId: id, seed, headline: rowHeadline(seed) };
}

/** Rows whose rules all settled go, so none lands later as a stale card. */
function dropSettledRows(state: ChatState, ruleIds: readonly RuleId[]): ChatState {
  if (ruleIds.length === 0) return state;
  return { ...state, messages: state.messages.filter((m) => !(m.kind === "row" && m.seed.card.ruleIds.length > 0 && m.seed.card.ruleIds.every((id) => ruleIds.includes(id)))) };
}

/** A details row with no step stays where it is until tapped; only step rows and the watch row step up on their own. */
function stepsUpAlone(row: Row): boolean {
  return !(row.seed.card.kind === "details" && row.seed.step === null);
}

/** The row to step up after a card settled: a watch row first, else the first row after the card, else the earliest. */
function nextRow(state: ChatState, cardId: string): Row | null {
  const rows = state.messages.filter((m): m is Row => m.kind === "row" && stepsUpAlone(m));
  const watch = rows.find((r) => r.seed.card.kind === "watch");
  if (watch !== undefined) return watch;
  const index = state.messages.findIndex((m) => m.id === cardId);
  return rows.find((r) => state.messages.indexOf(r) > index) ?? rows[0] ?? null;
}

/** The one rule a seed stands for; null for a batch, the lock, the watch and the write-up. */
function singleRule(seed: CardSeed): RuleId | null {
  return seed.card.ruleIds.length === 1 ? (seed.card.ruleIds[0] ?? null) : null;
}

function lastPersonIndex(state: ChatState): number {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) if (state.messages[i]?.kind === "person") return i;
  return -1;
}

/** True when an open card already names the seed's rule, or a row for it already sits in the current exchange. */
function rowCovered(state: ChatState, seed: CardSeed): boolean {
  const rule = singleRule(seed);
  if (rule === null) return false;
  const since = lastPersonIndex(state);
  return state.messages.some((m, i) => (m.kind === "card" && (m.state === "idle" || m.state === "working") && m.card.ruleIds.includes(rule)) || (m.kind === "row" && i > since && singleRule(m.seed) === rule));
}

/** The rows of the current exchange that name the rule go, so the card landing for it is not also listed. */
function dropExchangeRows(state: ChatState, rule: RuleId | null): ChatState {
  if (rule === null) return state;
  const since = lastPersonIndex(state);
  return { ...state, messages: state.messages.filter((m, i) => !(m.kind === "row" && i > since && singleRule(m.seed) === rule)) };
}

/** The first seed lands as the live card, the rest as rows; a row for a rule already open or already listed is skipped. Nothing lands while a card works. */
function landCards(state: ChatState, at: number, seeds: readonly CardSeed[]): ChatState {
  let next = state;
  for (const [index, seed] of seeds.entries()) {
    const liveCard = index === 0 && next.working === null;
    if (!liveCard && rowCovered(next, seed)) continue;
    const [id, s] = alloc(next);
    next = liveCard ? demoteIdle(dropExchangeRows(s, singleRule(seed))) : s;
    next = liveCard ? { ...push(next, cardMessage(id, at, seed, true)), live: id } : push(next, rowMessage(id, at, seed));
  }
  return next;
}

function appMessage(id: string, at: number, answer: AppAnswer, since: ReportDiff | null = null): ChatMessage {
  return {
    id,
    kind: "app",
    at,
    headline: answer.headline,
    body: answer.body,
    urgent: answer.urgent === true,
    rows: answer.rows ?? [],
    groups: answer.groups ?? [],
    since,
    reading: null,
    sourceLine: answer.source ?? null,
    label: answer.label,
    lead: answer.lead ?? null,
    checklist: answer.checklist ?? null,
  };
}

function sinceRows(diff: ReportDiff | null): ChatAppRow[] {
  if (diff === null) return [];
  return [
    ...diff.fixed.map((id) => ({ key: `fixed:${id}`, text: guidedFor(id).done.replace("Done. ", ""), icon: "ok" as const })),
    ...diff.appeared.map((id) => ({ key: `new:${id}`, text: guidedFor(id).headline, icon: "bullet" as const })),
  ];
}

/** The opening's live card: the step a due reminder names (2f), else the urgent step when a critical step is undone, else the batch, else the first step. */
export function openingStep(undone: readonly GuidedStep[], reminders: readonly RuleId[] = []): GuidedStep | null {
  const due = undone.find((s) => ruleIdsOf(s).some((id) => reminders.includes(id)));
  if (due !== undefined) return due;
  const critical = undone.find((s) => ruleIdsOf(s).some((id) => severityFor(id) === "critical"));
  if (critical !== undefined) return critical;
  return undone.find((s) => s.kind === "batch") ?? undone[0] ?? null;
}

function opened(state: ChatState, action: Extract<ChatAction, { type: "opened" }>): ChatState {
  const { at, plan, undone, diff, same, brief, provider } = action;
  const base = { ...state, messages: [], stream: { kind: "idle" as const }, draft: state.draft, live: null, working: null, walking: false, lockShown: false, provider };
  const urgent = undone.some((s) => ruleIdsOf(s).some((id) => severityFor(id) === "critical"));
  const text = planText(plan, same);
  const rows = sinceRows(diff);
  const [id, s1] = alloc(base);
  const nothing = undone.length === 0 && text.title === PLAN.nothingMyself;
  // A due reminder is one line before the plan sentence, one per id (2f).
  const reminders = action.reminders ?? [];
  const answer: AppAnswer = {
    headline: nothing ? END.nothing : text.title,
    body: nothing ? (action.watchOn === true ? WATCH_ON.nextTime : END.nextTime) : text.body.length === 0 ? null : text.body,
    urgent,
    rows,
    label: "opening",
    lead: reminders.length === 0 ? null : reminders.map((id) => ACTIVITY.remind.due.replace("{headline}", guidedFor(id).headline)).join(" "),
  };
  let next = push(s1, appMessage(id, at, answer, diff));
  if (brief !== null) {
    const [bid, s2] = alloc(next);
    next = push(s2, { id: bid, kind: "model", at, turnId: "brief", text: brief.text, provider: brief.provider, streaming: false, stillWaiting: false, outsideScope: false });
  }
  const step = openingStep(undone, reminders);
  if (step !== null) next = landCards(next, at, [seedForStep(step)]);
  if (action.licensedMeta !== null) {
    const [nid, s3] = alloc(next);
    next = push(s3, { id: nid, kind: "notice", at, text: action.licensedMeta, wayOut: null });
  }
  return announce(next, answer.headline ?? "");
}

function lastPerson(state: ChatState): Person | null {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const m = state.messages[i];
    if (m?.kind === "person") return m;
  }
  return null;
}

function withoutTurn(state: ChatState, turnId: string): ChatState {
  return { ...state, messages: state.messages.filter((m) => !(m.kind === "model" && m.turnId === turnId)) };
}

/** The notice and the composer state for a failed turn; exhaustive over ExplainerFailure. */
function failureNotice(state: ChatState, reason: ExplainerFailure, until: string | null): { text: string; wayOut: WayOut; composer: ChatState["composer"] } | null {
  const remote = remoteOf(state.provider);
  switch (reason) {
    case "limit_reached": {
      const back = until === null ? EXPLAIN.limitBack : `${EXPLAIN.limitBackAtPrefix}${formatTime(until)}.`;
      return { text: `${EXPLAIN.limit[remote]} ${back}`, wayOut: null, composer: { kind: "limit", provider: remote, until } };
    }
    case "needs_sign_in":
    case "auth":
    case "no_api_key":
    case "not_configured":
      return { text: EXPLAIN.signedOut[remote], wayOut: { kind: "link", label: EXPLAIN.signInAgain, route: { name: "connect", returnTo: CHAT_ROUTE } }, composer: { kind: "signed_out", provider: remote } };
    case "provider_unavailable":
    case "timeout":
    case "network":
    case "unavailable":
    case "busy": {
      const text = state.provider === "apple" ? AI_UNAVAILABLE_COPY.helper_unavailable : EXPLAIN.didNotAnswer[remote];
      return { text, wayOut: { kind: "chip", label: CHAT.tryAgain, action: "try_again" }, composer: { kind: "ready" } };
    }
    case "too_long":
      return { text: CHAT.tooLong, wayOut: null, composer: { kind: "ready" } };
    case "rejected_output":
    case "refused":
    case "unknown":
      return { text: CHAT.couldNotUse, wayOut: null, composer: { kind: "ready" } };
    case "cancelled":
      return null;
    default: {
      const never: never = reason;
      return never;
    }
  }
}

function stopped(state: ChatState, turnId: string): ChatState {
  if (state.stream.kind === "idle" || state.stream.turnId !== turnId) return state;
  const person = lastPerson(state);
  let next = withoutTurn(state, turnId);
  if (person !== null) next = patch(next, person.id, (m) => (m.kind === "person" ? { ...m, stopped: true, resend: true } : m));
  return announce({ ...next, stream: { kind: "idle" }, composer: next.composer.kind === "busy" ? { kind: "ready" } : next.composer }, CHAT.stopped);
}

function modelFailed(state: ChatState, action: Extract<ChatAction, { type: "model_failed" }>): ChatState {
  const { at, turnId, reason, until } = action;
  if (state.stream.kind === "idle" || state.stream.turnId !== turnId) return state;
  const notice = failureNotice(state, reason, until);
  if (notice === null) return stopped(state, turnId);
  // A provider notice carries its own way out; a dropped reply has none, so the person's turn gains "Send again".
  const dropped = reason === "rejected_output" || reason === "refused" || reason === "unknown";
  const person = lastPerson(state);
  const [id, s1] = alloc(withoutTurn(state, turnId));
  let next = push(s1, { id, kind: "notice", at, text: notice.text, wayOut: notice.wayOut });
  if (dropped && person !== null) next = patch(next, person.id, (m) => (m.kind === "person" ? { ...m, resend: true } : m));
  return announce({ ...next, stream: { kind: "idle" }, composer: notice.composer }, notice.text);
}

function cardResult(state: ChatState, action: Extract<ChatAction, { type: "card_result" }>): ChatState {
  const { at, cardId, outcome, line, rows } = action;
  const card = state.messages.find((m): m is Card => m.kind === "card" && m.id === cardId);
  if (card === undefined || (card.state !== "working" && card.state !== "idle" && card.state !== "failed")) return state;
  // The pane is open and the watcher runs: the card keeps working with its result line and "Check again" link.
  if (outcome === "pane_opened") {
    return announce(patch(state, cardId, (m) => (m.kind === "card" ? { ...m, state: "working", live: false, result: line } : m)), `${line} ${SHOW.notice}`);
  }
  const failure = action.failure ?? null;
  let next = patch(state, cardId, (m) => (m.kind === "card" ? { ...m, state: failure === null ? "resolved" : "failed", live: failure !== null, outcome, result: line, rows, failure } : m));
  next = { ...next, working: next.working === cardId ? null : next.working, live: failure !== null ? cardId : next.live === cardId ? null : next.live };
  // A failed card keeps its primary ("Try again", "Show me where"); otherwise the next row steps up, unless the walk's timer does.
  if (failure === null && !next.walking) {
    next = dropSettledRows(next, [...card.card.ruleIds, ...(action.settledRuleIds ?? [])]);
    const row = nextRow(next, cardId);
    if (row !== null) next = promote(next, at, row.id);
  }
  return announce(next, line);
}

/** A row becomes the live card at the end of the log; the row itself goes. */
function promote(state: ChatState, at: number, rowId: string): ChatState {
  const row = state.messages.find((m) => m.kind === "row" && m.id === rowId);
  if (row === undefined || row.kind !== "row" || state.working !== null) return state;
  // The list draws one row per rule of a batch; promoting one takes its siblings with it.
  const sameStep = (m: ChatMessage) => m.kind === "row" && row.seed.step !== null && m.seed.step?.id === row.seed.step.id;
  const without = { ...state, messages: state.messages.filter((m) => m.id !== rowId && !sameStep(m)) };
  return announce(landCards(without, at, [row.seed]), row.headline);
}

function availabilityChanged(state: ChatState, availability: AiAvailability, until: string | null): ChatState {
  const remote = remoteOf(state.provider);
  const { composer } = state;
  if (composer.kind === "busy") return state;
  switch (availability) {
    case "available": {
      if (composer.kind === "ready") return state;
      // Every turn that failed under the limit or the sign-out may be sent again now.
      const messages = state.messages.map((m, i): ChatMessage => (m.kind === "person" && state.messages[i + 1]?.kind === "notice" ? { ...m, resend: true } : m));
      return { ...state, messages, composer: { kind: "ready" } };
    }
    case "limit_reached":
      return { ...state, composer: { kind: "limit", provider: remote, until } };
    case "needs_sign_in":
      return { ...state, composer: { kind: "signed_out", provider: remote } };
    case "provider_unavailable":
      return { ...state, composer: { kind: "did_not_answer", provider: state.provider } };
    default:
      return state;
  }
}

/** The walk's checklist follows the cards: after any action that moves a card, its rows are re-read in place (keyed, so the log is not re-announced). */
function syncWalkMessage(state: ChatState): ChatState {
  const walk = [...state.messages].reverse().find((m) => m.kind === "app" && m.label === "walk");
  if (walk === undefined || walk.kind !== "app" || walk.checklist === null) return state;
  const synced = syncWalk(walk.checklist, state.messages);
  if (sameChecklist(synced, walk.checklist)) return state;
  const next = patch(state, walk.id, (m) => (m.kind === "app" ? { ...m, checklist: synced } : m));
  // The status element announces the progress line when a row settles; a row stepping up keeps the card's own announcement.
  return synced.done === walk.checklist.done ? next : announce(next, ACTIVITY.plan.progress.replace("{done}", String(synced.done)).replace("{of}", String(synced.of)));
}

export function reduce(state: ChatState, action: ChatAction): ChatState {
  return syncWalkMessage(reduceAction(state, action));
}

function reduceAction(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "opened":
      return opened(state, action);
    case "step_appended":
    case "card_appended":
      return landCards(state, action.at, [action.seed]);
    case "brief_ready": {
      const index = state.messages.findIndex((m) => m.kind === "app" && m.label === "opening");
      if (index === -1) return state;
      const [id, s1] = alloc(state);
      const block: ChatMessage = { id, kind: "model", at: action.at, turnId: "brief", text: action.text, provider: action.provider, streaming: false, stillWaiting: false, outsideScope: false };
      return { ...s1, messages: [...s1.messages.slice(0, index + 1), block, ...s1.messages.slice(index + 1)] };
    }
    case "guard_refused":
    case "notice_added": {
      const [id, s1] = alloc(state);
      return announce(push(s1, { id, kind: "notice", at: action.at, text: action.text, wayOut: action.type === "notice_added" ? action.wayOut : null }), action.text);
    }
    case "draft_received":
      return { ...state, draft: action.text };
    case "draft_consumed":
      return { ...state, draft: null };
    case "person_sent": {
      if (state.stream.kind !== "idle") return state;
      const [pid, s1] = alloc(state);
      const [mid, s2] = alloc(s1);
      const typed = action.source !== "chip";
      let next = push(s2, { id: pid, kind: "person", at: action.at, text: action.text, source: typed ? "typed" : "chip", stopped: false, resend: false });
      next = push(next, { id: mid, kind: "model", at: action.at, turnId: action.turnId, text: "", provider: state.provider, streaming: true, stillWaiting: false, outsideScope: false });
      return announce({ ...next, stream: { kind: "waiting", turnId: action.turnId, since: action.at }, composer: { kind: "busy" }, calls: state.calls + 1 }, CHAT.writing);
    }
    case "chip_pressed": {
      const [id, s1] = alloc(state);
      return push(s1, { id, kind: "person", at: action.at, text: action.text, source: "chip", stopped: false, resend: false });
    }
    case "app_answered": {
      const { answer } = action;
      const [id, s1] = alloc(state);
      let next = push(s1, appMessage(id, action.at, answer));
      if (answer.rowsOnly === true) {
        for (const seed of answer.cards ?? []) {
          const [rid, s] = alloc(next);
          next = push(s, rowMessage(rid, action.at, seed));
        }
      } else {
        next = landCards(next, action.at, answer.cards ?? []);
      }
      if (answer.walking === true) next = { ...next, walking: true };
      return announce(next, answer.headline ?? answer.body ?? "");
    }
    case "model_partial": {
      if (state.stream.kind === "idle" || state.stream.turnId !== action.turnId) return state;
      const next = patch(state, modelId(state, action.turnId), (m) => (m.kind === "model" ? { ...m, text: action.text, stillWaiting: false } : m));
      return { ...next, stream: { kind: "streaming", turnId: action.turnId, since: state.stream.since, lastPartialAt: action.at } };
    }
    case "model_still_waiting": {
      if (state.stream.kind === "idle" || state.stream.turnId !== action.turnId) return state;
      const next = patch(state, modelId(state, action.turnId), (m) => (m.kind === "model" ? { ...m, stillWaiting: true } : m));
      return announce(next, CHAT.stillWaiting[waitingKey(state.provider)]);
    }
    case "model_ready": {
      if (state.stream.kind === "idle" || state.stream.turnId !== action.turnId) return state;
      // A blank reply never renders as an empty block: it is the dropped-reply line instead.
      if (action.result.reply.trim().length === 0) return modelFailed(state, { type: "model_failed", at: action.at, turnId: action.turnId, reason: "rejected_output", until: null });
      let next = patch(state, modelId(state, action.turnId), (m) => (m.kind === "model" ? { ...m, text: action.result.reply, streaming: false, stillWaiting: false, outsideScope: action.result.outsideScope } : m));
      if (action.result.outsideScope) {
        const [oid, s] = alloc(next);
        next = push(s, { id: oid, kind: "notice", at: action.at, text: CHAT.outside, wayOut: null });
      }
      next = landCards(next, action.at, action.cards);
      for (const seed of action.related) {
        if (rowCovered(next, seed)) continue;
        const [rid, s] = alloc(next);
        next = push(s, rowMessage(rid, action.at, seed));
      }
      if (action.lockedMeta !== null) {
        const [nid, s] = alloc(next);
        next = push(s, { id: nid, kind: "notice", at: action.at, text: action.lockedMeta, wayOut: null });
      }
      next = { ...next, stream: { kind: "idle" }, composer: next.composer.kind === "busy" ? { kind: "ready" } : next.composer };
      const first = action.cards[0];
      return announce(next, first === undefined ? CHAT.doneWriting : `${CHAT.doneWriting} ${cardHeadline(first)}`);
    }
    case "model_failed":
      return modelFailed(state, action);
    case "stopped":
      return stopped(state, action.turnId);
    case "card_started": {
      const card = state.messages.find((m) => m.kind === "card" && m.id === action.cardId);
      if (card === undefined || card.kind !== "card" || state.working !== null || (card.state !== "idle" && card.state !== "failed")) return state;
      return { ...patch(state, action.cardId, (m) => (m.kind === "card" ? { ...m, state: "working", live: false, failure: null } : m)), live: null, working: action.cardId };
    }
    case "card_result":
      return cardResult(state, action);
    case "row_promoted":
      return promote(state, action.at, action.rowId);
    case "card_stale": {
      const card = state.messages.find((m) => m.kind === "card" && m.id === action.cardId);
      if (card === undefined || card.kind !== "card" || card.state === "resolved" || card.state === "stale") return state;
      let next = patch(state, action.cardId, (m) => (m.kind === "card" ? { ...m, state: "stale", live: false, outcome: "stale", result: action.line } : m));
      next = { ...next, live: next.live === action.cardId ? null : next.live, working: next.working === action.cardId ? null : next.working };
      if (next.working === null && !next.walking) {
        next = dropSettledRows(next, card.card.ruleIds);
        const row = nextRow(next, action.cardId);
        if (row !== null) next = promote(next, action.at, row.id);
      }
      return next;
    }
    case "lock_shown": {
      if (state.lockShown) return state;
      const next = landCards(state, action.at, [{ card: { kind: "lock", ruleId: null, ruleIds: action.ruleIds, severity: null }, step: null, item: null }]);
      return { ...next, lockShown: true };
    }
    case "lock_dismissed": {
      const lock = state.messages.find((m) => m.kind === "card" && m.card.kind === "lock" && m.state === "idle");
      if (lock === undefined) return state;
      const next = patch(state, lock.id, (m) => (m.kind === "card" ? { ...m, state: "resolved", live: false, result: CHAT.ok } : m));
      return announce({ ...next, live: next.live === lock.id ? null : next.live }, CHAT.ok);
    }
    case "end_reached": {
      const [id, s1] = alloc(state);
      let next = push(s1, appMessage(id, action.at, { headline: action.title, body: action.body, groups: action.groups, label: "end" }));
      if (action.brief !== null) {
        const [bid, s2] = alloc(next);
        next = push(s2, { id: bid, kind: "model", at: action.at, turnId: "end", text: action.brief.text, provider: action.brief.provider, streaming: false, stillWaiting: false, outsideScope: false });
      }
      return announce({ ...next, walking: false }, action.title);
    }
    case "watch_noticed": {
      const seed = { ...watchCard(action.item), noticedAt: action.changedAt };
      const next = landCards(demoteIdle(state), action.at, [seed]);
      return announce(next, cardHeadline(seed));
    }
    case "watch_returned": {
      if (!action.ran) return state;
      const [id, s1] = alloc(state);
      return announce(push(s1, appMessage(id, action.at, { headline: null, body: FISHY.recover.body, label: "result" })), FISHY.recover.body);
    }
    case "availability_changed":
      return availabilityChanged(state, action.state, action.until);
    case "counter_near_limit":
      return announce(state, CHAT.left.replace("{n}", String(action.left)));
    case "explain_state":
      return announce(state, action.text);
    case "walk_ended":
      return { ...state, walking: false };
    case "card_copied":
      return patch(state, action.cardId, (m) => (m.kind === "card" ? { ...m, copiedAt: action.at } : m));

    case "cleared":
      return { ...state, messages: [], stream: { kind: "idle" }, composer: state.composer.kind === "busy" ? { kind: "ready" } : state.composer, live: null, working: null, walking: false, lockShown: false, calls: 0 };
  }
}

function modelId(state: ChatState, turnId: string): string {
  return state.messages.find((m) => m.kind === "model" && m.turnId === turnId)?.id ?? "";
}
