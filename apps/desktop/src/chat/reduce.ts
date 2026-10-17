import type { AiAvailability, ExplainerFailure, GuidedStep, ReportDiff } from "@talos/core";
import { AI_UNAVAILABLE_COPY, formatTime } from "../app/labels";
import { CHAT, END, EXPLAIN, FISHY, PLAN, SHOW } from "../guided/copy";
import { guidedFor, planText, ruleIdsOf, severityFor } from "../guided/plan";
import { cardHeadline, seedForStep, watchCard } from "./cards";
import { remoteOf, waitingKey } from "./providers";
import { CHAT_ROUTE } from "./routes";
import type { AppAnswer, CardSeed, ChatAction, ChatAppRow, ChatMessage, ChatState, WayOut } from "./state";

/** The pure reducer of docs/DESIGN-CHAT-UI.md section 4. An event that does not apply is ignored, never thrown. */

type Card = Extract<ChatMessage, { kind: "card" }>;
type Person = Extract<ChatMessage, { kind: "person" }>;

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

/** Every idle card becomes a row in place, so one card holds the primary. */
function demoteIdle(state: ChatState): ChatState {
  const messages = state.messages.map((m): ChatMessage => {
    if (m.kind !== "card" || m.state !== "idle") return m;
    const seed: CardSeed = { card: m.card, step: m.step, item: m.item, noticedAt: m.noticedAt };
    return { id: m.id, kind: "row", at: m.at, cardId: m.cardId, seed, headline: cardHeadline(seed) };
  });
  return { ...state, messages, live: null };
}

function cardMessage(id: string, at: number, seed: CardSeed, live: boolean): Card {
  return { id, kind: "card", at, cardId: id, card: seed.card, step: seed.step, item: seed.item, noticedAt: seed.noticedAt ?? null, state: "idle", live, result: null, rows: [], failure: null };
}

function rowMessage(id: string, at: number, seed: CardSeed): ChatMessage {
  return { id, kind: "row", at, cardId: id, seed, headline: cardHeadline(seed) };
}

/** The first seed lands as the live card, the rest as rows. Nothing lands while a card works. */
function landCards(state: ChatState, at: number, seeds: readonly CardSeed[]): ChatState {
  let next = state;
  for (const [index, seed] of seeds.entries()) {
    const [id, s] = alloc(next);
    const liveCard = index === 0 && next.working === null;
    next = liveCard ? demoteIdle(s) : s;
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
    source: answer.source ?? null,
    label: answer.label,
  };
}

function sinceRows(diff: ReportDiff | null): ChatAppRow[] {
  if (diff === null) return [];
  return [
    ...diff.fixed.map((id) => ({ key: `fixed:${id}`, text: guidedFor(id).done.replace("Done. ", ""), icon: "ok" as const })),
    ...diff.appeared.map((id) => ({ key: `new:${id}`, text: guidedFor(id).headline, icon: "bullet" as const })),
  ];
}

/** The opening's live card: the urgent step when a critical step is undone, else the batch, else the first step. */
export function openingStep(undone: readonly GuidedStep[]): GuidedStep | null {
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
  const answer: AppAnswer = {
    headline: nothing ? END.nothing : text.title,
    body: nothing || text.body.length === 0 ? null : text.body,
    urgent,
    rows,
    label: "opening",
  };
  let next = push(s1, appMessage(id, at, answer, diff));
  if (brief !== null) {
    const [bid, s2] = alloc(next);
    next = push(s2, { id: bid, kind: "model", at, turnId: "brief", text: brief.text, provider: brief.provider, streaming: false, stillWaiting: false, outsideScope: false });
  }
  const step = openingStep(undone);
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
  const person = lastPerson(state);
  let next = withoutTurn(state, turnId);
  if (person !== null && notice.wayOut?.kind === "chip") next = patch(next, person.id, (m) => (m.kind === "person" ? { ...m, resend: true } : m));
  const [id, s1] = alloc(next);
  next = push(s1, { id, kind: "notice", at, text: notice.text, wayOut: notice.wayOut });
  return announce({ ...next, stream: { kind: "idle" }, composer: notice.composer }, notice.text);
}

function cardResult(state: ChatState, action: Extract<ChatAction, { type: "card_result" }>): ChatState {
  const { at, cardId, outcome, line, rows } = action;
  const card = state.messages.find((m): m is Card => m.kind === "card" && m.id === cardId);
  if (card === undefined || (card.state !== "working" && card.state !== "idle")) return state;
  // The pane is open and the watcher runs: the card keeps working with its result line and "Check again" link.
  if (outcome === "pane_opened") {
    return announce(patch(state, cardId, (m) => (m.kind === "card" ? { ...m, state: "working", live: false, result: line } : m)), `${line} ${SHOW.notice}`);
  }
  const failure = action.failure ?? null;
  let next = patch(state, cardId, (m) => (m.kind === "card" ? { ...m, state: failure === null ? "resolved" : "failed", live: failure !== null, result: line, rows, failure } : m));
  next = { ...next, working: next.working === cardId ? null : next.working, live: failure !== null ? cardId : next.live === cardId ? null : next.live };
  // A failed card keeps its primary ("Try again", "Show me where"); otherwise the next row steps up, unless the walk's timer does.
  if (failure === null && !next.walking) {
    const row = next.messages.find((m) => m.kind === "row");
    if (row !== undefined && row.kind === "row") next = promote(next, at, row.id);
  }
  return announce(next, line);
}

/** A row becomes the live card at the end of the log; the row itself goes. */
function promote(state: ChatState, at: number, rowId: string): ChatState {
  const row = state.messages.find((m) => m.kind === "row" && m.id === rowId);
  if (row === undefined || row.kind !== "row" || state.working !== null) return state;
  const without = { ...state, messages: state.messages.filter((m) => m.id !== rowId) };
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

export function reduce(state: ChatState, action: ChatAction): ChatState {
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
      next = landCards(next, action.at, answer.cards ?? []);
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
      let next = patch(state, modelId(state, action.turnId), (m) => (m.kind === "model" ? { ...m, text: action.result.reply, streaming: false, stillWaiting: false, outsideScope: action.result.outsideScope } : m));
      next = landCards(next, action.at, action.cards);
      for (const seed of action.related) {
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
      const next = patch(state, action.cardId, (m) => (m.kind === "card" ? { ...m, state: "stale", live: false, result: action.line } : m));
      return { ...next, live: next.live === action.cardId ? null : next.live, working: next.working === action.cardId ? null : next.working };
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
    case "walk_ended":
      return { ...state, walking: false };
    case "cleared":
      return { ...state, messages: [], stream: { kind: "idle" }, composer: state.composer.kind === "busy" ? { kind: "ready" } : state.composer, live: null, working: null, walking: false, lockShown: false, calls: 0 };
  }
}

function modelId(state: ChatState, turnId: string): string {
  return state.messages.find((m) => m.kind === "model" && m.turnId === turnId)?.id ?? "";
}
