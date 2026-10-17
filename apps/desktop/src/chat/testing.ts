import type { Allowed, ChatCall, ChatResult, ExplainOptions, ExplainerFailure, ExplainerPort, ExplainerProfile, ExplainerResult, GuidedMemory, GuidedPlan, GuidedStep, ScanReport, WatchItem } from "@talos/core";
import { DEV_MACHINE, EMPTY_GUIDED_MEMORY, MACOS_CATALOG, buildAllowed, buildGuidedPlan, evaluate, freeFixRuleIds } from "@talos/core";
import { vi } from "vitest";
import { noExplainer } from "../app/testing";
import type { ChatBridge, ChatSettled } from "../guided/state";
import type { ChatAction, ChatState } from "./state";
import { initialChatState, reduce } from "./state";

/** Fixtures for the chat tests: the dev-machine plan, a scripted chat port, and a reducer runner. */

export const NOW = "2026-10-16T10:00:00.000Z";
export const AT = Date.parse(NOW);
export const PROFILE: ExplainerProfile = { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true };
export const REPORT: ScanReport = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: NOW, os: "macos" });

export function planFor(licensed: boolean, memory: GuidedMemory = EMPTY_GUIDED_MEMORY): GuidedPlan {
  return buildGuidedPlan(REPORT, { freeFixes: freeFixRuleIds(REPORT), licensed }, PROFILE, memory, NOW);
}

export function allowedFor(plan: GuidedPlan, licensed: boolean, done: readonly string[] = []): Allowed {
  return buildAllowed({ plan, report: REPORT, gate: { freeFixes: freeFixRuleIds(REPORT), licensed }, scanReady: true, watchEnabled: true, memory: EMPTY_GUIDED_MEMORY, doneStepIds: done });
}

/** The steps a card can be drawn from: batch, fix, show and permission; the paywall is the lock card's business. */
export function undoneOf(plan: GuidedPlan, done: readonly string[] = []): GuidedStep[] {
  return plan.steps.filter((s) => s.kind !== "paywall" && !done.includes(s.id));
}

export function stepById(plan: GuidedPlan, id: string): GuidedStep {
  const step = plan.steps.find((s) => s.id === id);
  if (step === undefined) throw new Error(`no step ${id}`);
  return step;
}

export const ACT_ITEM: WatchItem = {
  signalId: "sig.persistence_new",
  kind: "persistence",
  severity: "critical",
  points: 10,
  change: "appeared",
  changedAt: "2026-10-16T13:32:00.000Z",
  gated: false,
  snoozedUntil: null,
  hasStartupEntry: true,
  isListener: false,
  actionIds: [],
  modelSentence: null,
  modelProvider: null,
};

export function openedAction(plan: GuidedPlan, overrides: Partial<Extract<ChatAction, { type: "opened" }>> = {}): ChatAction {
  return { type: "opened", at: AT, plan, undone: undoneOf(plan), diff: null, same: false, brief: null, provider: "chatgpt", reading: null, licensedMeta: null, ...overrides };
}

/** Folds the actions over the initial state. */
export function run(actions: readonly ChatAction[], provider: ChatState["provider"] = "chatgpt"): ChatState {
  return actions.reduce(reduce, initialChatState(provider));
}

export const REPLY: ChatResult = { reply: "The disk matters because a lost bag means lost photos.", relatedRuleIds: [], outsideScope: false, intents: [], locked: [] };

export interface ScriptedChat {
  /** The partials to stream before settling, whole replies so far. */
  readonly partials?: readonly string[];
  readonly result?: ExplainerResult<ChatResult>;
  /** Resolve only when `settle` is called from the test. */
  readonly hold?: boolean;
  /** Fail with this reason after `failAfter` partials. */
  readonly fail?: ExplainerFailure;
  readonly failAfter?: number;
}

/** An ExplainerPort whose chat follows a script and records every call; nothing else answers. */
export function scriptedExplainer(script: ScriptedChat = {}) {
  const calls: ChatCall[] = [];
  let release: (() => void) | null = null;
  const port: ExplainerPort = {
    ...noExplainer,
    id: "chatgpt",
    availability: async () => "available",
    async chat(call: ChatCall, options?: ExplainOptions<ChatResult>): Promise<ExplainerResult<ChatResult>> {
      calls.push(call);
      const partials = script.partials ?? [];
      for (const [index, reply] of partials.entries()) {
        if (script.fail !== undefined && index === (script.failAfter ?? 0)) return { ok: false, reason: script.fail };
        if (options?.signal?.aborted === true) return { ok: false, reason: "cancelled" };
        options?.onPartial?.({ reply });
        await Promise.resolve();
      }
      if (script.fail !== undefined && partials.length <= (script.failAfter ?? 0)) return { ok: false, reason: script.fail };
      if (script.hold === true) await new Promise<void>((resolve) => (release = resolve));
      if (options?.signal?.aborted === true) return { ok: false, reason: "cancelled" };
      return script.result ?? { ok: true, value: REPLY };
    },
  };
  return { port, calls, settle: () => release?.() };
}

/** A ChatBridge over a fixed plan: every mutation is a vi.fn, `settled` is what settle() answers next, `done` the settled step ids. */
export function fakeBridge(plan: GuidedPlan, overrides: Partial<ChatBridge> = {}) {
  const control = { settled: null as ChatSettled | null, done: [] as string[], watchingSince: null as string | null };
  const undone = () => plan.steps.filter((s) => s.kind !== "paywall" && !control.done.includes(s.id));
  const bridge: ChatBridge = {
    plan,
    diff: null,
    resumed: false,
    active: null,
    walking: false,
    fixed: [],
    leftAlone: [],
    get doneStepIds() {
      return control.done;
    },
    permission: "not_determined",
    undone,
    nextUndone: () => undone()[0] ?? null,
    atEnd: () => undone().length === 0,
    run: vi.fn(),
    checkAgain: vi.fn(async () => null),
    settle: vi.fn(() => {
      const s = control.settled;
      control.settled = null;
      return s;
    }),
    observeShow: vi.fn(() => null),
    watchingSince: () => control.watchingSince,
    later: vi.fn(() => []),
    accept: vi.fn(),
    answerNo: vi.fn(),
    leaveAlone: vi.fn(),
    snoozePaywall: vi.fn(),
    unlock: vi.fn(() => []),
    setWalking: vi.fn(),
    stepByStep: vi.fn(),
    leaveChat: vi.fn(),
    toChat: vi.fn(),
    rescan: vi.fn(),
    ...overrides,
  };
  return { bridge, control };
}
