import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuidedMemory, RuleId } from "@talos/core";
import { aiAskedRecently } from "@talos/core";
import type { Route, Router } from "../app/router";
import { autoAdvanceMs } from "../guided/timing";
import type { AppSettings } from "../settings";
import type { AiConnectController, AiConnectPort, ConnectOffered, ConnectOutcome, ConnectPoll, ConnectProvider, ConnectStage } from "./ai-connect";
import { CONNECT_BUSY_ATTEMPTS, CONNECT_BUSY_RETRY_MS, CONNECT_POLL_MS, CONNECT_SETTLE_ATTEMPTS, CONNECT_SETTLE_MS, CONNECT_TIMEOUT_MS } from "./ai-connect";
import type { AiController } from "./useAiAvailability";

export interface AiConnectDeps {
  readonly port: AiConnectPort;
  readonly router: Router;
  readonly settings: AppSettings;
  updateSettings(patch: Partial<AppSettings>): void;
  readonly memory: GuidedMemory;
  saveMemory(next: GuidedMemory): void;
  readonly ai: AiController;
  /** The done tick waits while the window is unfocused and takes the reduced-motion time, like a guided step. */
  readonly windowFocused: boolean;
  readonly reducedMotion: boolean;
  readonly now?: () => string;
}

function isConnectProvider(provider: string): provider is ConnectProvider {
  return provider === "chatgpt" || provider === "claude_plan";
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The screen shown until start() answers: ChatGPT opens the browser at once; Claude may have to verify or fetch first. */
function initialStage(provider: ConnectProvider): ConnectStage {
  return provider === "claude_plan" ? { kind: "starting", provider } : { kind: "waiting", provider };
}

type StartResult = { readonly kind: "started"; readonly poll: ConnectPoll } | { readonly kind: "done" } | { readonly kind: "failed" } | { readonly kind: "abandoned" };

/** Outcomes the controller itself produced: the worker has still to notice and report its end. */
function endedByUs(outcome: ConnectOutcome): boolean {
  return outcome === "closed" || outcome === "timeout";
}

/**
 * Drives a ChatGPT or Claude sign-in: starts the Rust job, polls it on a flat 2 s interval for
 * at most 10 min, writes the provider on success and goes back to where the person came from.
 * Lives in App so a job keeps being polled while the person visits Details or Settings.
 */
export function useAiConnect(deps: AiConnectDeps): AiConnectController {
  const [stage, setStage] = useState<ConnectStage>({ kind: "choose" });
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const [offered, setOffered] = useState<ConnectOffered | null>(null);
  const [resumeExplain, setResumeExplain] = useState<RuleId | null>(null);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const offeredAsked = useRef(false);
  const resumeRef = useRef<RuleId | null>(null);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef<ConnectProvider | null>(null);
  /** Bumped by every start(); a start still waiting on the port stops once a newer one began. */
  const generation = useRef(0);
  /** The provider a successful connect wrote; the probe runs once the availability for it is null. */
  const pendingProbe = useRef<string | null>(null);
  const now = useCallback(() => depsRef.current.now?.() ?? new Date().toISOString(), []);

  const stopPolling = useCallback(() => {
    if (poller.current !== null) clearInterval(poller.current);
    if (deadline.current !== null) clearTimeout(deadline.current);
    poller.current = null;
    deadline.current = null;
    running.current = null;
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  /** Asks once; the first AI surface to mount asks, never a launch or the scan. */
  const ensureOffered = useCallback(() => {
    if (offeredAsked.current) return;
    offeredAsked.current = true;
    depsRef.current.port.offered().then(setOffered, () => setOffered({ chatgpt: false, claude_plan: false, apple: true }));
  }, []);

  const goBack = useCallback(() => {
    const { router } = depsRef.current;
    if (router.route.name === "connect") router.back();
  }, []);

  /** Writes the provider and turns the switch on, clears the one it replaces and shows the done tick; the effect below returns. */
  const finishDone = useCallback((provider: ConnectProvider | "apple") => {
    const { port, settings, updateSettings } = depsRef.current;
    const previous = settings.explainer.provider;
    // Switching replaces: the old provider's stored sign-in goes with it.
    if (isConnectProvider(previous) && previous !== provider) void port.disconnect(previous).catch(() => undefined);
    // Connecting is the person's request to use an AI: a switch left off would leave Claude connected but every surface hidden.
    updateSettings({ explainer: { ...settings.explainer, provider, aiEnabled: true } });
    pendingProbe.current = provider;
    setStage({ kind: "done", provider });
  }, []);

  // The done tick returns after the guided auto-advance time, paused while the window is unfocused.
  const doneKey = stage.kind === "done" ? stage.provider : null;
  useEffect(() => {
    if (doneKey === null || !deps.windowFocused) return;
    const timer = setTimeout(() => {
      if (stageRef.current.kind !== "done") return;
      goBack();
      setStage({ kind: "choose" });
    }, autoAdvanceMs(deps.reducedMotion));
    return () => clearTimeout(timer);
  }, [doneKey, deps.windowFocused, deps.reducedMotion, goBack]);

  // The availability hook forgets its state when the provider changes; probe once it has.
  useEffect(() => {
    const expected = pendingProbe.current;
    if (expected === null || deps.settings.explainer.provider !== expected || deps.ai.availability !== null) return;
    pendingProbe.current = null;
    void deps.ai.probe(true);
  }, [deps.settings.explainer.provider, deps.ai.availability, deps.ai]);

  /**
   * Cancel and the deadline are ours: the worker notices on its next tick, and a probe that lands
   * before then reads `connecting`. Ask the port to stop, read the job until the worker has
   * reported its end (bounded), then probe. A job that ends done anyway has stored its sign-in,
   * so it is kept rather than left on the Mac unseen. A newer start owns the outcome from then on.
   */
  const settleThenProbe = useCallback(
    async (provider: ConnectProvider, outcome: ConnectOutcome) => {
      const mine = generation.current;
      const { port, ai } = depsRef.current;
      if (endedByUs(outcome)) {
        await port.cancel(provider).catch(() => undefined);
        for (let i = 0; i < CONNECT_SETTLE_ATTEMPTS; i += 1) {
          if (generation.current !== mine) return;
          const poll = await port.poll(provider).catch((): ConnectPoll | null => null);
          if (poll !== null && poll.stage !== "fetching" && poll.stage !== "signing_in") {
            if (generation.current !== mine) return;
            if (poll.stage === "done") return finishDone(provider);
            break;
          }
          await wait(CONNECT_SETTLE_MS);
        }
        if (generation.current !== mine) return;
      }
      // The AI surfaces read the outcome (plan_not_eligible, provider_unavailable, not_connected) from a fresh probe.
      await ai.probe(true).catch(() => undefined);
    },
    [finishDone],
  );

  const fail = useCallback(
    (provider: ConnectProvider, outcome: ConnectOutcome) => {
      stopPolling();
      setStage({ kind: "failed", provider, outcome });
      void settleThenProbe(provider, outcome);
    },
    [settleThenProbe, stopPolling],
  );

  /** One reading of the job, from start() or a poll, moved onto the screen. */
  const applyPoll = useCallback(
    (provider: ConnectProvider, poll: ConnectPoll) => {
      switch (poll.stage) {
        case "idle":
          return;
        case "fetching":
          setStage(provider === "claude_plan" ? { kind: "fetching", provider } : { kind: "waiting", provider });
          return;
        case "signing_in":
          setStage({ kind: "waiting", provider });
          return;
        case "done":
          stopPolling();
          finishDone(provider);
          return;
        case "failed":
          fail(provider, poll.outcome);
          return;
      }
    },
    [fail, finishDone, stopPolling],
  );

  const pollOnce = useCallback(
    async (provider: ConnectProvider) => {
      let poll: ConnectPoll;
      try {
        poll = await depsRef.current.port.poll(provider);
      } catch {
        return;
      }
      if (running.current !== provider) return;
      applyPoll(provider, poll);
    },
    [applyPoll],
  );

  /**
   * Asks the port to start the job. "busy" means a job for this provider is still winding down (a
   * cancelled worker takes a moment to notice): wait for it to end, then start once more. A job that
   * ends done is the sign-in that was wanted.
   */
  const startJob = useCallback(async (provider: ConnectProvider, live: () => boolean): Promise<StartResult> => {
    const { port } = depsRef.current;
    const attempt = async (): Promise<StartResult | "busy"> => {
      try {
        return { kind: "started", poll: await port.start(provider) };
      } catch (error) {
        return errorCode(error) === "busy" ? "busy" : { kind: "failed" };
      }
    };
    const first = await attempt();
    if (first !== "busy") return first;
    for (let i = 0; i < CONNECT_BUSY_ATTEMPTS; i += 1) {
      await wait(CONNECT_BUSY_RETRY_MS);
      if (!live()) return { kind: "abandoned" };
      const poll = await port.poll(provider).catch((): ConnectPoll | null => null);
      if (poll === null || poll.stage === "fetching" || poll.stage === "signing_in") continue;
      if (poll.stage === "done") return { kind: "done" };
      const second = await attempt();
      return second === "busy" ? { kind: "failed" } : second;
    }
    return { kind: "failed" };
  }, []);

  const start = useCallback(
    (provider: ConnectProvider) => {
      const previous = running.current;
      stopPolling();
      running.current = provider;
      generation.current += 1;
      const mine = generation.current;
      const live = () => generation.current === mine && running.current === provider;
      setStage(initialStage(provider));
      const begin = () => {
        if (!live()) return;
        void pollOnce(provider);
        poller.current = setInterval(() => void pollOnce(provider), CONNECT_POLL_MS);
        deadline.current = setTimeout(() => fail(provider, "timeout"), CONNECT_TIMEOUT_MS);
      };
      // The hook was already polling this provider's job: keep it rather than opening a second sign-in.
      if (previous === provider) return begin();
      const launch = async () => {
        // One provider at a time: the other provider's job is stopped before this one starts.
        if (previous !== null) await depsRef.current.port.cancel(previous).catch(() => undefined);
        if (!live()) return;
        const result = await startJob(provider, live);
        if (!live()) return;
        switch (result.kind) {
          case "started":
            // The seeded stage: a Claude helper already on the Mac skips the fetching screen.
            applyPoll(provider, result.poll);
            if (live()) begin();
            return;
          case "done":
            stopPolling();
            return finishDone(provider);
          case "failed":
            return fail(provider, "provider_unavailable");
          case "abandoned":
            return;
        }
      };
      void launch();
    },
    [applyPoll, fail, finishDone, pollOnce, startJob, stopPolling],
  );

  const useThisMac = useCallback(() => {
    const previous = running.current;
    stopPolling();
    // One provider at a time: a sign-in still running is stopped, not left to finish unseen.
    if (previous !== null) void depsRef.current.port.cancel(previous).catch(() => undefined);
    finishDone("apple");
  }, [finishDone, stopPolling]);

  const cancel = useCallback(() => {
    const provider = running.current;
    if (provider === null) return;
    fail(provider, "closed");
  }, [fail]);

  const open = useCallback(
    (returnTo: Route, options?: { readonly explainRuleId?: RuleId }) => {
      const rule = options?.explainRuleId ?? null;
      resumeRef.current = rule;
      setResumeExplain(rule);
      setStage({ kind: "choose" });
      ensureOffered();
      depsRef.current.router.navigate({ name: "connect", returnTo });
    },
    [ensureOffered],
  );

  const tryAgain = useCallback(() => {
    const current = stageRef.current;
    if (current.kind === "failed") start(current.provider);
  }, [start]);

  const chooseAnother = useCallback(() => {
    setStage({ kind: "choose" });
  }, []);

  const notNow = useCallback(() => {
    const { memory, saveMemory } = depsRef.current;
    saveMemory({ ...memory, aiAskedAt: now() });
    resumeRef.current = null;
    setResumeExplain(null);
    setStage({ kind: "choose" });
    goBack();
  }, [goBack, now]);

  const signInAgain = useCallback(
    (returnTo: Route, options?: { readonly explainRuleId?: RuleId }) => {
      open(returnTo, options);
      const provider = depsRef.current.settings.explainer.provider;
      if (isConnectProvider(provider)) start(provider);
    },
    [open, start],
  );

  const disconnect = useCallback(async () => {
    const { port, settings } = depsRef.current;
    const provider = settings.explainer.provider;
    if (isConnectProvider(provider)) {
      try {
        await port.disconnect(provider);
      } catch {
        // The sign-in is still on this Mac: the probed state stands and the Settings row says so.
        return false;
      }
    }
    await depsRef.current.ai.probe(true).catch(() => undefined);
    return true;
  }, []);

  const consumeResume = useCallback((ruleId: RuleId) => {
    if (resumeRef.current !== ruleId) return false;
    resumeRef.current = null;
    setResumeExplain(null);
    return true;
  }, []);

  const askedRecently = aiAskedRecently(deps.memory, now());
  const connectable = offered !== null && (offered.chatgpt || offered.claude_plan);

  return useMemo(
    () => ({
      stage,
      offered,
      connectable,
      askedRecently,
      resumeExplain,
      ensureOffered,
      open,
      start,
      useThisMac,
      cancel,
      tryAgain,
      chooseAnother,
      notNow,
      signInAgain,
      disconnect,
      consumeResume,
    }),
    [stage, offered, connectable, askedRecently, resumeExplain, ensureOffered, open, start, useThisMac, cancel, tryAgain, chooseAnother, notNow, signInAgain, disconnect, consumeResume],
  );
}
