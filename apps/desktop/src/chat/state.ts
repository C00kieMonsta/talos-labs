import type { AiAvailability, ChatCard, ChatOutcome, ChatResult, ExplainerFailure, FixError, GuidedPlan, GuidedStep, ReportDiff, RuleId, WatchItem } from "@talos/core";
import type { Route } from "../app/router";
import type { GuidedRowIcon } from "../guided/GuidedList";
import type { DoneRow } from "../guided/state";
import type { ExplainerProvider } from "../settings";

/** The chat's transcript state (docs/DESIGN-CHAT-UI.md section 4). Pure data; the reducer lives in reduce.ts. */

/** The key into EXPLAIN.limit, signedOut and didNotAnswer. */
export type Remote = "chatgpt" | "claude_plan";

export type ChipId = "do_them_all" | "fix_what_you_can" | "what_is_urgent" | "what_first" | "whats_next" | "show_list" | "check_again" | "leave_alone" | "why" | "try_again" | "send_again";

export type ChatLabel = "opening" | "answer" | "end" | "watch" | "result";

/** A plain list row inside an app message (the batch list, the since rows, the end groups). */
export interface ChatAppRow {
  readonly key: string;
  readonly text: string;
  readonly icon: GuidedRowIcon;
  readonly tag?: string;
}

export interface ChatGroup {
  readonly label: string;
  readonly rows: readonly ChatAppRow[];
}

/** What a card is drawn from: the catalogue card, the plan step behind it (fix, batch, show, permission) and the watch item (watch). */
export interface CardSeed {
  readonly card: ChatCard;
  readonly step: GuidedStep | null;
  readonly item: WatchItem | null;
  /** watch cards: item.changedAt ?? state.lastCheckAt, for the time sentence. */
  readonly noticedAt?: string | null;
}

export type CardState = "idle" | "working" | "resolved" | "failed" | "stale";

export interface CardFailure {
  readonly error: FixError | "still_failing" | "unreadable";
  readonly batch: boolean;
}

export type WayOut = { readonly kind: "chip"; readonly label: string; readonly action: ChipId } | { readonly kind: "link"; readonly label: string; readonly route: Route } | null;

export type ChatMessage =
  | {
      readonly id: string;
      readonly kind: "app";
      readonly at: number;
      readonly headline: string | null;
      readonly body: string | null;
      readonly urgent: boolean;
      readonly rows: readonly ChatAppRow[];
      readonly groups: readonly ChatGroup[];
      readonly since: ReportDiff | null;
      /** DESIGN-DAILY is not built: always null. */
      readonly reading: null;
      /** A quieter line after the body (the watch's source line). */
      readonly sourceLine: string | null;
      readonly label: ChatLabel;
    }
  | { readonly id: string; readonly kind: "person"; readonly at: number; readonly text: string; readonly source: "typed" | "chip"; readonly stopped: boolean; readonly resend: boolean }
  | {
      readonly id: string;
      readonly kind: "model";
      readonly at: number;
      readonly turnId: string;
      readonly text: string;
      readonly provider: ExplainerProvider;
      readonly streaming: boolean;
      readonly stillWaiting: boolean;
      readonly outsideScope: boolean;
    }
  | {
      readonly id: string;
      readonly kind: "card";
      readonly at: number;
      readonly cardId: string;
      readonly card: ChatCard;
      readonly step: GuidedStep | null;
      readonly item: WatchItem | null;
      readonly noticedAt: string | null;
      readonly state: CardState;
      readonly live: boolean;
      readonly result: string | null;
      readonly rows: readonly DoneRow[];
      readonly failure: CardFailure | null;
    }
  | { readonly id: string; readonly kind: "row"; readonly at: number; readonly cardId: string; readonly seed: CardSeed; readonly headline: string }
  | { readonly id: string; readonly kind: "notice"; readonly at: number; readonly text: string; readonly wayOut: WayOut };

export type ChatStream = { readonly kind: "idle" } | { readonly kind: "waiting"; readonly turnId: string; readonly since: number } | { readonly kind: "streaming"; readonly turnId: string; readonly since: number; readonly lastPartialAt: number };

export type ChatComposer =
  | { readonly kind: "ready" }
  | { readonly kind: "busy" }
  | { readonly kind: "limit"; readonly provider: Remote; readonly until: string | null }
  | { readonly kind: "signed_out"; readonly provider: Remote }
  | { readonly kind: "did_not_answer"; readonly provider: ExplainerProvider };

export interface ChatState {
  readonly messages: readonly ChatMessage[];
  readonly stream: ChatStream;
  readonly composer: ChatComposer;
  /** Set by draft_received, consumed by the composer once. */
  readonly draft: string | null;
  /** The card id holding the primary. */
  readonly live: string | null;
  /** The card id in flight; at most one. */
  readonly working: string | null;
  /** "Do them all". */
  readonly walking: boolean;
  readonly lockShown: boolean;
  /** Developer counter: typed turns and "Why?". */
  readonly calls: number;
  readonly announce: { readonly text: string; readonly seq: number };
  readonly provider: ExplainerProvider;
  /** The next message id. */
  readonly seq: number;
}

/** What an app message carries when appended by app_answered, end_reached or watch_noticed. */
export interface AppAnswer {
  readonly headline: string | null;
  readonly body: string | null;
  readonly urgent?: boolean;
  readonly rows?: readonly ChatAppRow[];
  readonly groups?: readonly ChatGroup[];
  readonly source?: string | null;
  readonly cards?: readonly CardSeed[];
  readonly label: ChatLabel;
  /** "Do them all": the first card is live and the walk advances after each tick. */
  readonly walking?: boolean;
  /** "Show me the list": every card lands as a row and none is live. */
  readonly rowsOnly?: boolean;
}

/** The events of docs/DESIGN-CHAT-UI.md section 4, every payload. `at` is Date.now() so the reducer stays pure. */
export type ChatAction =
  | { readonly type: "opened"; readonly at: number; readonly plan: GuidedPlan; readonly undone: readonly GuidedStep[]; readonly diff: ReportDiff | null; readonly same: boolean; readonly brief: { readonly text: string; readonly provider: ExplainerProvider } | null; readonly provider: ExplainerProvider; readonly reading: null; readonly licensedMeta: string | null }
  | { readonly type: "step_appended"; readonly at: number; readonly seed: CardSeed }
  | { readonly type: "brief_ready"; readonly at: number; readonly text: string; readonly provider: ExplainerProvider }
  | { readonly type: "guard_refused"; readonly at: number; readonly text: string }
  | { readonly type: "notice_added"; readonly at: number; readonly text: string; readonly wayOut: WayOut }
  | { readonly type: "draft_received"; readonly text: string; readonly autoSend: boolean }
  | { readonly type: "draft_consumed" }
  | { readonly type: "person_sent"; readonly at: number; readonly text: string; readonly turnId: string; readonly source?: "typed" | "chip" }
  | { readonly type: "chip_pressed"; readonly at: number; readonly chipId: ChipId; readonly text: string }
  | { readonly type: "app_answered"; readonly at: number; readonly answer: AppAnswer }
  | { readonly type: "model_partial"; readonly at: number; readonly turnId: string; readonly text: string }
  | { readonly type: "model_still_waiting"; readonly turnId: string }
  | { readonly type: "model_ready"; readonly at: number; readonly turnId: string; readonly result: ChatResult; readonly cards: readonly CardSeed[]; readonly related: readonly CardSeed[]; readonly lockedMeta: string | null }
  | { readonly type: "model_failed"; readonly at: number; readonly turnId: string; readonly reason: ExplainerFailure; readonly until: string | null }
  | { readonly type: "stopped"; readonly at: number; readonly turnId: string }
  | { readonly type: "card_started"; readonly cardId: string }
  | { readonly type: "card_result"; readonly at: number; readonly cardId: string; readonly outcome: ChatOutcome; readonly line: string; readonly rows: readonly DoneRow[]; readonly failure?: CardFailure | null }
  | { readonly type: "row_promoted"; readonly at: number; readonly rowId: string }
  | { readonly type: "card_appended"; readonly at: number; readonly seed: CardSeed }
  | { readonly type: "card_stale"; readonly cardId: string; readonly line: string }
  | { readonly type: "lock_shown"; readonly at: number; readonly ruleIds: readonly RuleId[] }
  | { readonly type: "lock_dismissed" }
  | { readonly type: "end_reached"; readonly at: number; readonly title: string; readonly body: string | null; readonly groups: readonly ChatGroup[]; readonly brief: { readonly text: string; readonly provider: ExplainerProvider } | null }
  | { readonly type: "watch_noticed"; readonly at: number; readonly item: WatchItem; readonly changedAt: string | null }
  | { readonly type: "watch_returned"; readonly at: number; readonly ran: boolean }
  | { readonly type: "availability_changed"; readonly state: AiAvailability; readonly until: string | null }
  | { readonly type: "counter_near_limit"; readonly left: number }
  | { readonly type: "walk_ended" }
  | { readonly type: "cleared" };

export function initialChatState(provider: ExplainerProvider): ChatState {
  return {
    messages: [],
    stream: { kind: "idle" },
    composer: { kind: "ready" },
    draft: null,
    live: null,
    working: null,
    walking: false,
    lockShown: false,
    calls: 0,
    announce: { text: "", seq: 0 },
    provider,
    seq: 1,
  };
}

export { reduce } from "./reduce";
