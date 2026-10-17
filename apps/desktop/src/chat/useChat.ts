import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ActivityEvent, AiAvailability, Allowed, ExplainerFailure, RuleId } from "@talos/core";
import { MACOS_CATALOG, askWhyQuestion, buildAllowed, toExplainerContext } from "@talos/core";
import { useApp } from "../app/context";
import { watchActive } from "../app/gate";
import { motionOff } from "../app/motion";
import { useConnect } from "../scan/ai-connect";
import { limitReprobeMs } from "../scan/useAiAvailability";
import { lastReport } from "../scan/machine";
import { useFishyController } from "../guided/fishy/controller";
import { formatDate } from "../app/labels";
import { CHAT, FISHY, SHOW, WATCH } from "../guided/copy";
import type { ChatBridge } from "../guided/state";
import { STALE_AFTER_MS, autoAdvanceMs, paced } from "../guided/timing";
import { useWatchController } from "../watch/watch-controller";
import { chatActivityRow } from "./ChatActivity";
import type { Chip } from "./chips";
import { chipsFor } from "./chips";
import { createChatController } from "./controller";
import type { ChatController } from "./controller";
import { ChatDraftContext } from "./draft";
import type { ActivityExtras } from "./handlers";
import { openingStep } from "./reduce";
import { CHAT_ROUTE } from "./routes";
import { seedForStep, severityOf } from "./cards";
import { ruleIdsOf } from "../guided/plan";
import type { ChatState } from "./state";
import { initialChatState, reduce } from "./state";

/** The still-waiting line after this long with no partial. */
export const CHAT_STILL_WAITING_MS = 8000;
/** Partials are applied at most this often; the reduced-motion step is four hundred. */
export const CHAT_PARTIAL_MS = 80;
export const CHAT_REDUCED_PARTIAL_MS = 400;
/** "Check now" with no watch:state answer: the row reads "couldn't check". */
export const CHAT_WATCH_CHECK_MS = 20_000;

const STATE_FAILURES: readonly ExplainerFailure[] = ["needs_sign_in", "limit_reached", "provider_unavailable"];

export interface UseChat {
  readonly state: ChatState;
  readonly chips: readonly Chip[];
  readonly controller: ChatController;
  /** A model turn runs: the spiral breathes and the explain disclosure refuses. */
  readonly busy: boolean;
  readonly extras: ActivityExtras;
  /** Bumped when the log must scroll whatever the position (the watch's act-now). */
  readonly forced: number;
  /** Bumped when the walk's timer promoted the next card, so focus can follow it. */
  readonly promoted: number;
  readonly reducedMotion: boolean;
  /** The composer crossed sixty characters left: the status element says so once. */
  nearLimit(left: number): void;
}

/** The chat over the bridge (docs/DESIGN-CHAT-UI.md section 4): the reducer, the timers, the derivations and the subscriptions. */
export function useChat(bridge: ChatBridge): UseChat {
  const { adapters, settings, scan, ai, gate, router, guidedMemory } = useApp();
  const watch = useWatchController();
  const fishy = useFishyController();
  const connect = useConnect();
  const { draft, consume } = useContext(ChatDraftContext);
  const reducedMotion = motionOff();
  const [state, dispatch] = useReducer(reduce, settings.explainer.provider, initialChatState);
  const [extras, setExtras] = useState<ActivityExtras>({});
  const [forced, setForced] = useState(0);
  const [promoted, setPromoted] = useState(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const live = useRef({ bridge, settings, scan, ai, gate, router, guidedMemory, watch, fishy, connect, adapters });
  live.current = { bridge, settings, scan, ai, gate, router, guidedMemory, watch, fishy, connect, adapters };
  const abort = useRef<AbortController | null>(null);
  const partial = useRef<{ turnId: string; text: string; timer: ReturnType<typeof setTimeout> | null; lastAt: number }>({ turnId: "", text: "", timer: null, lastAt: 0 });
  const pendingCheck = useRef<{ cardId: string; timer: ReturnType<typeof setTimeout>; sawChecking: boolean } | null>(null);
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allowed = useCallback((): Allowed => {
    const { bridge: b, scan: s, gate: g, settings: st, guidedMemory: m } = live.current;
    const report = lastReport(s.scan);
    const plan = b.plan;
    if (plan === null || report === null) return { fix: [], batch: [], show: [], explain: [], details: [], snooze: [], accept: [], investigate: [], remind: [], whatIf: [], kinds: [], accepted: [], snoozed: [] };
    const watchItems = (live.current.watch.state?.items ?? []).map((item) => item.signalId);
    return buildAllowed({ plan, report, gate: { freeFixes: plan.freeFixes, licensed: g.licensed }, scanReady: s.scan.kind === "ready", watchEnabled: watchActive(st, g), memory: m, doneStepIds: b.doneStepIds, watchItems });
  }, []);

  const setRow = useCallback((cardId: string, row: ActivityEvent) => {
    setExtras((prev) => {
      const rows = prev[cardId] ?? [];
      const index = rows.findIndex((r) => r.id === row.id);
      const next = index === -1 ? [...rows, row] : rows.map((r, i) => (i === index ? { ...row, at: r.at } : r));
      return { ...prev, [cardId]: next };
    });
  }, []);

  const controller = useMemo<ChatController>(() => {
    const flush = () => {
      const p = partial.current;
      p.timer = null;
      p.lastAt = Date.now();
      dispatch({ type: "model_partial", at: p.lastAt, turnId: p.turnId, text: p.text });
    };
    return createChatController({
      dispatch,
      getState: () => stateRef.current,
      bridge: live.current.bridge,
      now: () => Date.now(),
      nowIso: () => new Date().toISOString(),
      report: () => lastReport(live.current.scan.scan),
      allowed,
      licensed: () => live.current.gate.licensed,
      watchOn: () => watchActive(live.current.settings, live.current.gate),
      context: () => {
        const report = lastReport(live.current.scan.scan);
        return report === null ? null : toExplainerContext(report, MACOS_CATALOG, live.current.settings.profile, Object.keys(live.current.guidedMemory.accepted) as RuleId[]);
      },
      explainer: () => live.current.adapters.createExplainer(live.current.settings.explainer),
      explainRunning: () => {
        const s = live.current.scan.scan;
        return (s.kind === "ready" || s.kind === "rechecking") && s.explain.kind === "running";
      },
      watchState: () => live.current.watch.state,
      provider: () => (live.current.settings.explainer.provider === "apple" ? "on_device" : "remote"),
      until: () => live.current.ai.until,
      navigate: (route) => live.current.router.navigate(route),
      openConnect: () => live.current.connect.open(CHAT_ROUTE),
      openFishy: () => live.current.fishy.open(CHAT_ROUTE, "noticed"),
      openBuyPage: () => void live.current.adapters.fixes.openBuyPage(),
      acknowledge: (signalId) => void live.current.watch.acknowledge(signalId),
      checkWatch: (cardId) => {
        if (pendingCheck.current !== null) return;
        dispatch({ type: "card_started", cardId });
        setRow(cardId, chatActivityRow(cardId, "watch_check", "running", Date.now()));
        live.current.watch.checkNow();
        const timer = setTimeout(() => {
          pendingCheck.current = null;
          setRow(cardId, chatActivityRow(cardId, "watch_check", "failed", Date.now(), "unavailable"));
          dispatch({ type: "card_result", at: Date.now(), cardId, outcome: "could_not_check", line: CHAT.checkFailed, rows: [] });
        }, paced(CHAT_WATCH_CHECK_MS));
        pendingCheck.current = { cardId, timer, sawChecking: false };
      },
      scheduleWalk: () => {
        if (walkTimer.current !== null) clearTimeout(walkTimer.current);
        walkTimer.current = setTimeout(() => {
          walkTimer.current = null;
          if (controllerRef.current?.walkNext() === true) setPromoted((n) => n + 1);
        }, autoAdvanceMs(motionOff()));
      },
      abort: () => abort.current?.abort(),
      signal: () => {
        abort.current?.abort();
        abort.current = new AbortController();
        return abort.current.signal;
      },
      onPartial: (turnId, text) => {
        const p = partial.current;
        if (abort.current?.signal.aborted === true) return;
        p.turnId = turnId;
        p.text = text;
        const every = motionOff() ? CHAT_REDUCED_PARTIAL_MS : CHAT_PARTIAL_MS;
        if (p.timer !== null) return;
        const wait = Math.max(0, every - (Date.now() - p.lastAt));
        if (wait === 0) flush();
        else p.timer = setTimeout(flush, wait);
      },
      onFailure: (reason) => {
        // The provider's state changed mid-turn: the AI controller hears it without a probe, as a failed explain would.
        if (STATE_FAILURES.includes(reason as ExplainerFailure)) live.current.ai.report({ state: reason as AiAvailability, until: live.current.ai.until });
      },
      clipboard: async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      },
      date: () => formatDate(new Date().toISOString()),
    });
  }, [allowed, setRow]);
  const controllerRef = useRef<ChatController | null>(null);
  controllerRef.current = controller;

  // The opening, once per report; a relaunch for Full Disk Access appends the first undone step's card.
  const openedFor = useRef<string | null>(null);
  const plan = bridge.plan;
  useEffect(() => {
    if (plan === null || openedFor.current === plan.reportId) return;
    openedFor.current = plan.reportId;
    const undone = bridge.undone();
    const locked = !gate.licensed && plan.locked.length > 0 ? plan.locked.length : 0;
    dispatch({
      type: "opened",
      at: Date.now() - (window.__talosDemoChat?.openingAgoMs ?? 0),
      plan,
      undone,
      diff: bridge.diff,
      same: false,
      brief: null,
      provider: settings.explainer.provider,
      reading: null,
      licensedMeta: locked === 0 ? null : locked === 1 ? CHAT.moreLockedOne : CHAT.moreLocked.replace("{n}", String(locked)),
      watchOn: watchActive(live.current.settings, live.current.gate),
      reminders: bridge.reminders,
    });
    const first = undone[0];
    if (bridge.resumed && first !== undefined && openingStep(undone)?.id !== first.id) {
      dispatch({ type: "step_appended", at: Date.now(), seed: seedForStep(first) });
    }
    // Demo only: writeup=1 opens the write-up card on the opening, once.
    if (window.__talosDemoChat?.openWriteUp === true && !openedWriteUp.current) {
      openedWriteUp.current = true;
      controllerRef.current?.chip("write_up");
    }
  }, [plan, bridge, gate.licensed, settings.explainer.provider]);
  const openedWriteUp = useRef(false);

  // Eight seconds with no partial, before or between partials: one line under the caret, removed by the next partial.
  const stream = state.stream;
  useEffect(() => {
    if (stream.kind === "idle") return;
    const timer = setTimeout(() => dispatch({ type: "model_still_waiting", turnId: stream.turnId }), paced(CHAT_STILL_WAITING_MS));
    return () => clearTimeout(timer);
  }, [stream]);

  // The working card follows the scan machine: a settled fix or batch, a passed or expired watcher, the open pane.
  const working = state.working;
  const workingCard = working === null ? null : state.messages.find((m) => m.kind === "card" && m.id === working);
  const scanState = scan.scan;
  useEffect(() => {
    if (working === null || workingCard === undefined || workingCard === null || workingCard.kind !== "card") return;
    const settled = bridge.settle() ?? bridge.observeShow();
    if (settled !== null) {
      if (settled.outcome === "watch_passed" || settled.outcome === "watch_expired") {
        setRow(working, chatActivityRow(working, "watching", settled.outcome === "watch_passed" ? "done" : "failed", Date.now(), settled.outcome === "watch_passed" ? null : "stale"));
      }
      controller.settled(settled);
      return;
    }
    if (workingCard.card.kind === "show" && workingCard.result === null && bridge.watchingSince() !== null) {
      setRow(working, chatActivityRow(working, "watching", "running", Date.now()));
      dispatch({ type: "card_result", at: Date.now(), cardId: working, outcome: "pane_opened", line: SHOW.opened, rows: [] });
    }
  }, [working, workingCard, scanState, bridge, controller, setRow, bridge.permission]);

  // A watcher with no change for ten seconds reads "no change yet" and keeps running; only the expiry fails the row.
  const watchingSince = working === null ? null : bridge.watchingSince();
  useEffect(() => {
    if (working === null || watchingSince === null) return;
    const timer = setTimeout(() => setRow(working, chatActivityRow(working, "watching", "running", Date.now(), "stale")), paced(STALE_AFTER_MS));
    return () => clearTimeout(timer);
  }, [working, watchingSince, scanState, setRow]);

  // A card whose item settled elsewhere (the walk-through, a watcher, Details) collapses to the stale line.
  const done = bridge.doneStepIds;
  useEffect(() => {
    const report = lastReport(scanState);
    for (const m of stateRef.current.messages) {
      if (m.kind !== "card" || m.state !== "idle" || m.step === null || !done.includes(m.step.id)) continue;
      const passes = report !== null && ruleIdsOf(m.step).length > 0 && ruleIdsOf(m.step).every((id) => report.results.find((r) => r.ruleId === id)?.status === "pass");
      dispatch({ type: "card_stale", at: Date.now(), cardId: m.id, line: passes ? CHAT.staleDone : CHAT.staleWaiting });
    }
  }, [done, scanState]);

  // The watch's act-now while the chat is on screen: one exchange per item, never while the fishy flow is up.
  const noticed = useRef<string | null>(null);
  const watchState = watch.state;
  useEffect(() => {
    // The row resolves on the first state after one that read checking, or the fallback.
    const p = pendingCheck.current;
    if (p !== null) {
      if (watchState?.checking === true) p.sawChecking = true;
      else if (p.sawChecking) {
        clearTimeout(p.timer);
        setRow(p.cardId, chatActivityRow(p.cardId, "watch_check", "done", Date.now()));
        dispatch({ type: "card_result", at: Date.now(), cardId: p.cardId, outcome: "checked", line: WATCH.checkedJustNow, rows: [] });
        pendingCheck.current = null;
      }
    }
    if (watchState === null || watchState.rating !== "act_now" || !watchState.licensed || live.current.router.route.name === "fishy") return;
    const item = watchState.items[0];
    if (item === undefined) return;
    const key = `${item.signalId}:${item.changedAt ?? ""}`;
    if (noticed.current === key) return;
    noticed.current = key;
    dispatch({ type: "watch_noticed", at: Date.now(), item, changedAt: item.changedAt ?? watchState.lastCheckAt });
    setForced((f) => f + 1);
  }, [watchState, setRow]);

  // Back from the fishy flow: the recover line when the flow ran.
  const ranAt = watch.memory.fishyRanAt;
  const seenRan = useRef(ranAt);
  useEffect(() => {
    if (ranAt !== null && ranAt !== seenRan.current) dispatch({ type: "watch_returned", at: Date.now(), ran: true });
    seenRan.current = ranAt;
  }, [ranAt]);

  // The watch window's draft, once per seq: the exact "Why does ... matter?" of the top item sends at once, anything else lands in the field.
  const seenDraft = useRef<number | null>(null);
  const hasPlan = plan !== null;
  useEffect(() => {
    if (draft === null || !hasPlan || seenDraft.current === draft.seq) return;
    seenDraft.current = draft.seq;
    consume(draft.seq);
    const top = live.current.watch.state?.items[0] ?? null;
    const autoSend = top !== null && draft.text === askWhyQuestion(FISHY.noticed.headline[top.kind]);
    // A refused send (a disclosure or a turn running) falls back to the field so the question is not lost.
    if (!autoSend || !controller.send(draft.text)) dispatch({ type: "draft_received", text: draft.text, autoSend });
  }, [draft, hasPlan, controller, consume]);

  // The provider's state lands in the composer's line; the chat itself stays.
  const availability = ai.availability;
  useEffect(() => {
    if (availability !== null) dispatch({ type: "availability_changed", state: availability, until: ai.until });
  }, [availability, ai.until]);
  // The allowance comes back on its own: ask again at the provider's reset time, as the disclosure does.
  const { probe } = ai;
  const limited = state.composer.kind === "limit";
  useEffect(() => {
    if (!limited) return;
    const timer = setTimeout(() => void probe(true), limitReprobeMs(ai.until));
    return () => clearTimeout(timer);
  }, [limited, ai.until, probe]);

  useEffect(
    () => () => {
      abort.current?.abort();
      if (partial.current.timer !== null) clearTimeout(partial.current.timer);
      if (pendingCheck.current !== null) clearTimeout(pendingCheck.current.timer);
      if (walkTimer.current !== null) clearTimeout(walkTimer.current);
    },
    [],
  );

  const facts = useMemo(() => {
    const undone = bridge.undone();
    const liveCard = state.live === null ? null : state.messages.find((m) => m.kind === "card" && m.id === state.live);
    const liveSeverity = liveCard !== undefined && liveCard !== null && liveCard.kind === "card" ? liveCard.card.severity : null;
    const newest = [...state.messages].reverse().find((m) => m.kind === "card");
    return {
      ruleCard: newest !== undefined && newest.kind === "card" && newest.card.ruleId !== null,
      fixable: undone.some((s) => s.kind === "fix" || s.kind === "batch"),
      anyUndone: undone.length > 0,
      urgentOrHigh: undone.some((s) => {
        const sev = severityOf(ruleIdsOf(s));
        return sev === "critical" || sev === "high";
      }),
      urgentLive: liveSeverity === "critical",
      onDeviceCard: settings.explainer.provider === "apple" && newest !== undefined && newest.kind === "card" && newest.card.kind !== "accept" && state.messages.some((m) => m.kind === "model" && m.turnId !== "brief"),
    };
  }, [bridge, state.live, state.messages, settings.explainer.provider]);
  const chips = useMemo(() => chipsFor(state, facts), [state, facts]);

  const nearLimit = useCallback((left: number) => dispatch({ type: "counter_near_limit", left }), []);

  return { state, chips, controller, busy: state.stream.kind !== "idle", extras, forced, promoted, reducedMotion, nearLimit };
}
