import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { AiAvailability, GuidedMemory } from "@talos/core";
import { EMPTY_GUIDED_MEMORY } from "@talos/core";
import type { Route, Router } from "../app/router";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import { AUTO_ADVANCE_MS, AUTO_ADVANCE_REDUCED_MS } from "../guided/timing";
import type { AiConnectPort, ConnectOffered, ConnectPoll } from "./ai-connect";
import { CONNECT_BUSY_ATTEMPTS, CONNECT_BUSY_RETRY_MS, CONNECT_POLL_MS, CONNECT_SETTLE_ATTEMPTS, CONNECT_SETTLE_MS, CONNECT_TIMEOUT_MS } from "./ai-connect";
import { useAiConnect } from "./useAiConnect";

const NOW = "2026-10-16T12:00:00.000Z";
const GUIDED: Route = { name: "guided" };

interface FakePort extends AiConnectPort {
  polls: ConnectPoll[];
  offeredValue: ConnectOffered;
  /** What start() resolves with: the stage Rust seeded. Idle keeps the hook on its initial screen until the first poll. */
  startPoll: ConnectPoll;
  /** Thrown by every start() while set; `startErrorOnce` is thrown by the next start() only. */
  startError: string | null;
  startErrorOnce: string | null;
}

function fakePort(): FakePort {
  const port: FakePort = {
    polls: [],
    offeredValue: { chatgpt: true, claude_plan: true, apple: true },
    startPoll: { stage: "idle" },
    startError: null,
    startErrorOnce: null,
    offered: vi.fn(async () => port.offeredValue),
    start: vi.fn(async () => {
      if (port.startError !== null) throw new Error(port.startError);
      if (port.startErrorOnce !== null) {
        const error = port.startErrorOnce;
        port.startErrorOnce = null;
        throw new Error(error);
      }
      return port.startPoll;
    }),
    poll: vi.fn(async () => port.polls.length > 1 ? (port.polls.shift() as ConnectPoll) : (port.polls[0] ?? { stage: "idle" })),
    cancel: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  return port;
}

/** A router whose route the hook can read live; back() pops to the previous route. */
function fakeRouter(initial: Route): Router & { stack: Route[] } {
  const router = {
    stack: [initial],
    get route(): Route {
      return router.stack[router.stack.length - 1] as Route;
    },
    lastMove: "navigate" as const,
    navigate: vi.fn((route: Route) => {
      router.stack.push(route);
    }),
    back: vi.fn(() => {
      if (router.stack.length > 1) router.stack.pop();
    }),
    replace: vi.fn(),
  };
  return router;
}

interface HarnessProps {
  availability: AiAvailability | null;
  aiEnabled?: boolean;
  provider?: AppSettings["explainer"]["provider"];
  memory?: GuidedMemory;
  windowFocused?: boolean;
  reducedMotion?: boolean;
}

function harness(initialRoute: Route = GUIDED, props: HarnessProps = { availability: null }) {
  const port = fakePort();
  const router = fakeRouter(initialRoute);
  const probe = vi.fn(async () => "available" as const);
  const report = vi.fn();
  const hook = renderHook(
    (p: HarnessProps) => {
      const [settings, setSettings] = useState<AppSettings>({
        ...DEFAULT_SETTINGS,
        onboarded: true,
        explainer: { ...DEFAULT_SETTINGS.explainer, aiEnabled: p.aiEnabled ?? true, provider: p.provider ?? "apple" },
      });
      const [memory, setMemory] = useState<GuidedMemory>(p.memory ?? EMPTY_GUIDED_MEMORY);
      const connect = useAiConnect({
        port,
        router,
        settings,
        updateSettings: (patch) => setSettings((prev) => ({ ...prev, ...patch })),
        memory,
        saveMemory: setMemory,
        ai: { availability: p.availability, until: null, probe, reprobe: () => () => undefined, report },
        windowFocused: p.windowFocused ?? true,
        reducedMotion: p.reducedMotion ?? false,
        now: () => NOW,
      });
      return { connect, settings, memory };
    },
    { initialProps: props },
  );
  return { ...hook, port, router, probe, report };
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAiConnect offered", () => {
  it("never asks the port on mount (that would probe the Apple helper at launch); ensureOffered asks once and exposes offered and connectable", async () => {
    const h = harness();
    await tick(0);
    expect(h.port.offered).not.toHaveBeenCalled();
    expect(h.result.current.connect.offered).toBeNull();
    act(() => h.result.current.connect.ensureOffered());
    await tick(0);
    expect(h.port.offered).toHaveBeenCalledTimes(1);
    expect(h.result.current.connect.offered).toEqual({ chatgpt: true, claude_plan: true, apple: true });
    expect(h.result.current.connect.connectable).toBe(true);
    act(() => h.result.current.connect.ensureOffered());
    act(() => h.result.current.connect.open(GUIDED));
    expect(h.port.offered).toHaveBeenCalledTimes(1);
  });

  it("open() asks; nothing offered means not connectable", async () => {
    const h = harness(GUIDED, { availability: null, aiEnabled: false });
    h.port.offeredValue = { chatgpt: false, claude_plan: false, apple: true };
    await tick(0);
    expect(h.port.offered).not.toHaveBeenCalled();
    expect(h.result.current.connect.offered).toBeNull();
    act(() => h.result.current.connect.open(GUIDED));
    await tick(0);
    expect(h.port.offered).toHaveBeenCalledTimes(1);
    expect(h.result.current.connect.connectable).toBe(false);
  });
});

describe("useAiConnect open and resume", () => {
  it("open always navigates to the connect route, resets the stage and remembers the explain target", async () => {
    const h = harness();
    act(() => h.result.current.connect.open(GUIDED, { explainRuleId: "TL-MAC-001" }));
    expect(h.router.navigate).toHaveBeenCalledWith({ name: "connect", returnTo: GUIDED });
    expect(h.result.current.connect.stage).toEqual({ kind: "choose" });
    expect(h.result.current.connect.resumeExplain).toBe("TL-MAC-001");
    let consumed = false;
    act(() => {
      consumed = h.result.current.connect.consumeResume("TL-MAC-002");
    });
    expect(consumed).toBe(false);
    act(() => {
      consumed = h.result.current.connect.consumeResume("TL-MAC-001");
    });
    expect(consumed).toBe(true);
    expect(h.result.current.connect.resumeExplain).toBeNull();
    act(() => {
      consumed = h.result.current.connect.consumeResume("TL-MAC-001");
    });
    expect(consumed).toBe(false);
    // A second open from the overview still navigates.
    act(() => h.result.current.connect.open({ name: "overview" }));
    expect(h.router.navigate).toHaveBeenLastCalledWith({ name: "connect", returnTo: { name: "overview" } });
    expect(h.router.navigate).toHaveBeenCalledTimes(2);
  });
});

describe("useAiConnect sign-in", () => {
  it("polls every 2 s whatever the focus, maps the stages, writes the provider on done and goes back after 1400 ms", async () => {
    const h = harness();
    h.port.polls = [{ stage: "fetching" }, { stage: "signing_in" }, { stage: "signing_in" }, { stage: "done" }];
    act(() => h.result.current.connect.open(GUIDED, { explainRuleId: "TL-MAC-001" }));
    act(() => h.result.current.connect.start("claude_plan"));
    // Claude verifies or fetches before it answers: the choose screen waits with its primary disabled until start() resolves.
    expect(h.result.current.connect.stage).toEqual({ kind: "starting", provider: "claude_plan" });
    await tick(0);
    expect(h.port.start).toHaveBeenCalledWith("claude_plan");
    expect(h.result.current.connect.stage).toEqual({ kind: "fetching", provider: "claude_plan" });
    const pollsAfterStart = (h.port.poll as ReturnType<typeof vi.fn>).mock.calls.length;
    await tick(CONNECT_POLL_MS - 1);
    expect(h.port.poll).toHaveBeenCalledTimes(pollsAfterStart);
    await tick(1);
    expect(h.port.poll).toHaveBeenCalledTimes(pollsAfterStart + 1);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "claude_plan" });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await tick(CONNECT_POLL_MS);
    expect(h.port.poll).toHaveBeenCalledTimes(pollsAfterStart + 2);
    await tick(CONNECT_POLL_MS);
    expect(h.result.current.connect.stage).toEqual({ kind: "done", provider: "claude_plan" });
    expect(h.result.current.settings.explainer.provider).toBe("claude_plan");
    // The probe runs once the provider is written and the availability is null.
    expect(h.probe).toHaveBeenCalledWith(true);
    expect(h.probe).toHaveBeenCalledTimes(1);
    // The resume target survives a successful connect.
    expect(h.result.current.connect.resumeExplain).toBe("TL-MAC-001");
    expect(h.router.back).not.toHaveBeenCalled();
    await tick(AUTO_ADVANCE_MS);
    expect(h.router.back).toHaveBeenCalledTimes(1);
    expect(h.router.route).toEqual(GUIDED);
    expect(h.result.current.connect.stage).toEqual({ kind: "choose" });
    // Polling stopped on done.
    const polls = (h.port.poll as ReturnType<typeof vi.fn>).mock.calls.length;
    await tick(CONNECT_POLL_MS * 3);
    expect(h.port.poll).toHaveBeenCalledTimes(polls);
  });

  it("start() answers with the seeded stage: a Claude helper already on the Mac skips the fetching screen", async () => {
    const h = harness();
    h.port.startPoll = { stage: "signing_in" };
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.start("claude_plan"));
    expect(h.result.current.connect.stage).toEqual({ kind: "starting", provider: "claude_plan" });
    await tick(0);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "claude_plan" });
    // A seeded fetching stage shows the fetch screen before the first poll.
    const fetching = harness();
    fetching.port.startPoll = { stage: "fetching" };
    fetching.port.polls = [{ stage: "fetching" }];
    act(() => fetching.result.current.connect.start("claude_plan"));
    await tick(0);
    expect(fetching.result.current.connect.stage).toEqual({ kind: "fetching", provider: "claude_plan" });
    // A start that answers failed lands on the failure; one that answers done is the sign-in.
    const failed = harness();
    failed.port.startPoll = { stage: "failed", outcome: "fetch_failed" };
    act(() => failed.result.current.connect.start("claude_plan"));
    await tick(0);
    expect(failed.result.current.connect.stage).toEqual({ kind: "failed", provider: "claude_plan", outcome: "fetch_failed" });
    expect(failed.port.poll).not.toHaveBeenCalled();
    const done = harness();
    done.port.startPoll = { stage: "done" };
    act(() => done.result.current.connect.start("chatgpt"));
    await tick(0);
    expect(done.result.current.connect.stage).toEqual({ kind: "done", provider: "chatgpt" });
    expect(done.port.poll).not.toHaveBeenCalled();
  });

  it("a fetching poll for ChatGPT reads as waiting; ChatGPT starts on the waiting screen", async () => {
    const h = harness();
    h.port.polls = [{ stage: "fetching" }];
    act(() => h.result.current.connect.start("chatgpt"));
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
    await tick(0);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
  });

  it("an idle first poll keeps the initial screen for each provider", async () => {
    const claude = harness();
    claude.port.polls = [{ stage: "idle" }];
    act(() => claude.result.current.connect.start("claude_plan"));
    await tick(CONNECT_POLL_MS);
    expect(claude.result.current.connect.stage).toEqual({ kind: "starting", provider: "claude_plan" });
    const chatgpt = harness();
    chatgpt.port.polls = [{ stage: "idle" }];
    act(() => chatgpt.result.current.connect.start("chatgpt"));
    await tick(CONNECT_POLL_MS);
    expect(chatgpt.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
  });

  it("done away from the connect route writes the provider but never calls back()", async () => {
    const h = harness({ name: "settings" });
    h.port.polls = [{ stage: "done" }];
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(0);
    expect(h.result.current.connect.stage).toEqual({ kind: "done", provider: "chatgpt" });
    expect(h.result.current.settings.explainer.provider).toBe("chatgpt");
    await tick(AUTO_ADVANCE_MS);
    expect(h.router.back).not.toHaveBeenCalled();
    expect(h.result.current.connect.stage).toEqual({ kind: "choose" });
  });

  it("the done tick waits while the window is unfocused and takes the reduced-motion time, like a guided step", async () => {
    // The usual case: the poll turns done while the person is still in the browser.
    const h = harness(GUIDED, { availability: null, windowFocused: false });
    h.port.polls = [{ stage: "done" }];
    act(() => h.result.current.connect.open(GUIDED));
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(0);
    expect(h.result.current.connect.stage).toEqual({ kind: "done", provider: "chatgpt" });
    await tick(AUTO_ADVANCE_MS * 3);
    expect(h.router.back).not.toHaveBeenCalled();
    expect(h.result.current.connect.stage).toEqual({ kind: "done", provider: "chatgpt" });
    // Focus back: the tick stays its full time from then.
    h.rerender({ availability: null, windowFocused: true });
    await tick(AUTO_ADVANCE_MS - 1);
    expect(h.router.back).not.toHaveBeenCalled();
    await tick(1);
    expect(h.router.back).toHaveBeenCalledTimes(1);
    expect(h.result.current.connect.stage).toEqual({ kind: "choose" });

    const reduced = harness(GUIDED, { availability: null, reducedMotion: true });
    act(() => reduced.result.current.connect.open(GUIDED));
    act(() => reduced.result.current.connect.useThisMac());
    await tick(AUTO_ADVANCE_MS);
    expect(reduced.router.back).not.toHaveBeenCalled();
    await tick(AUTO_ADVANCE_REDUCED_MS - AUTO_ADVANCE_MS);
    expect(reduced.router.back).toHaveBeenCalledTimes(1);
  });

  it("a failed poll ends the job with its outcome; tryAgain restarts; chooseAnother returns to choose", async () => {
    const h = harness();
    h.port.polls = [{ stage: "failed", outcome: "plan_not_eligible" }];
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(0);
    expect(h.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "plan_not_eligible" });
    // The AI surfaces learn the outcome from a fresh probe.
    expect(h.probe).toHaveBeenCalledWith(true);
    expect(h.probe).toHaveBeenCalledTimes(1);
    const polls = (h.port.poll as ReturnType<typeof vi.fn>).mock.calls.length;
    await tick(CONNECT_POLL_MS * 2);
    expect(h.port.poll).toHaveBeenCalledTimes(polls);
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.tryAgain());
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
    expect(h.port.start).toHaveBeenCalledTimes(2);
    act(() => h.result.current.connect.cancel());
    expect(h.port.cancel).toHaveBeenCalledWith("chatgpt");
    expect(h.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "closed" });
    act(() => h.result.current.connect.chooseAnother());
    expect(h.result.current.connect.stage).toEqual({ kind: "choose" });
    // tryAgain and cancel outside a job do nothing.
    act(() => h.result.current.connect.tryAgain());
    act(() => h.result.current.connect.cancel());
    expect(h.port.start).toHaveBeenCalledTimes(2);
    expect(h.port.cancel).toHaveBeenCalledTimes(1);
  });

  it("times out after 10 min: cancels the job and shows the timeout screen", async () => {
    const h = harness();
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(CONNECT_TIMEOUT_MS - 1);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
    await tick(1);
    expect(h.port.cancel).toHaveBeenCalledWith("chatgpt");
    expect(h.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "timeout" });
    // The job never reports its end here: the settle reads stop after their bound, and so does the 2 s poll.
    await tick(CONNECT_SETTLE_MS * CONNECT_SETTLE_ATTEMPTS);
    const polls = (h.port.poll as ReturnType<typeof vi.fn>).mock.calls.length;
    await tick(CONNECT_POLL_MS * 2);
    expect(h.port.poll).toHaveBeenCalledTimes(polls);
    expect(h.probe).toHaveBeenCalledWith(true);
  });

  it("Cancel probes only once the worker has reported the job's end, so the surfaces never read a stale connecting", async () => {
    const h = harness();
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(0);
    // The Rust worker notices the cancel flag on its next tick: the job still reads signing_in for a while.
    let settled = false;
    (h.port.poll as ReturnType<typeof vi.fn>).mockImplementation(async () => (settled ? { stage: "failed", outcome: "closed" } : { stage: "signing_in" }));
    act(() => h.result.current.connect.cancel());
    expect(h.port.cancel).toHaveBeenCalledWith("chatgpt");
    expect(h.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "closed" });
    await tick(CONNECT_SETTLE_MS * 3);
    expect(h.probe).not.toHaveBeenCalled();
    settled = true;
    await tick(CONNECT_SETTLE_MS);
    expect(h.probe).toHaveBeenCalledWith(true);
    expect(h.probe).toHaveBeenCalledTimes(1);
    const cancelOrder = (h.port.cancel as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] as number;
    const probeOrder = h.probe.mock.invocationCallOrder[0] as number;
    expect(cancelOrder).toBeLessThan(probeOrder);
    // A Try again before the job settled owns the outcome: the old settle never probes.
    const again = harness();
    again.port.polls = [{ stage: "signing_in" }];
    act(() => again.result.current.connect.start("chatgpt"));
    await tick(0);
    act(() => again.result.current.connect.cancel());
    act(() => again.result.current.connect.tryAgain());
    await tick(CONNECT_SETTLE_MS * (CONNECT_SETTLE_ATTEMPTS + 1));
    expect(again.probe).not.toHaveBeenCalled();
    expect(again.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
  });

  it("a sign-in that finishes in the moment after Cancel is kept: its tokens are stored, so the provider is written", async () => {
    // The browser callback landed before the worker read the cancel flag; Rust keeps a finished job done.
    const h = harness(GUIDED, { availability: "available", provider: "apple" });
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(0);
    (h.port.poll as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ stage: "done" }));
    act(() => h.result.current.connect.cancel());
    expect(h.port.cancel).toHaveBeenCalledWith("chatgpt");
    expect(h.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "closed" });
    await tick(CONNECT_SETTLE_MS);
    expect(h.result.current.connect.stage).toEqual({ kind: "done", provider: "chatgpt" });
    expect(h.result.current.settings.explainer.provider).toBe("chatgpt");
    expect(h.port.disconnect).not.toHaveBeenCalled();
    // The same window after the deadline, on the Claude route: `auth login` exited signed in just as we gave up.
    const late = harness(GUIDED, { availability: "available", provider: "chatgpt" });
    late.port.polls = [{ stage: "signing_in" }];
    act(() => late.result.current.connect.start("claude_plan"));
    await tick(CONNECT_TIMEOUT_MS);
    expect(late.port.cancel).toHaveBeenCalledWith("claude_plan");
    expect(late.result.current.connect.stage).toEqual({ kind: "failed", provider: "claude_plan", outcome: "timeout" });
    (late.port.poll as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ stage: "done" }));
    await tick(CONNECT_SETTLE_MS);
    expect(late.result.current.connect.stage).toEqual({ kind: "done", provider: "claude_plan" });
    expect(late.result.current.settings.explainer.provider).toBe("claude_plan");
    // Switching replaces: the ChatGPT sign-in goes.
    expect(late.port.disconnect).toHaveBeenCalledWith("chatgpt");
  });

  it("start: not_offered fails as provider_unavailable", async () => {
    const h = harness();
    h.port.startError = "not_offered";
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(0);
    expect(h.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "provider_unavailable" });
    expect(h.port.poll).not.toHaveBeenCalled();
  });

  it("busy: waits for the stale job to end, then starts once more and polls the new job", async () => {
    // Cancel, then a quick Try again: the worker takes a moment to report closed.
    const h = harness();
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(0);
    act(() => h.result.current.connect.cancel());
    expect(h.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "closed" });
    h.port.startErrorOnce = "busy";
    h.port.polls = [{ stage: "signing_in" }, { stage: "failed", outcome: "closed" }, { stage: "signing_in" }];
    act(() => h.result.current.connect.tryAgain());
    await tick(0);
    expect(h.port.start).toHaveBeenCalledTimes(2);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
    // Still winding down after the first retry wait; closed after the second.
    await tick(CONNECT_BUSY_RETRY_MS);
    expect(h.port.start).toHaveBeenCalledTimes(2);
    await tick(CONNECT_BUSY_RETRY_MS);
    expect(h.port.start).toHaveBeenCalledTimes(3);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
    await tick(CONNECT_POLL_MS);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
  });

  it("busy: a stale job that ends done is taken as the sign-in; one that never ends fails", async () => {
    const done = harness();
    done.port.startError = "busy";
    done.port.polls = [{ stage: "signing_in" }, { stage: "done" }];
    act(() => done.result.current.connect.start("claude_plan"));
    await tick(CONNECT_BUSY_RETRY_MS * 2);
    expect(done.result.current.connect.stage).toEqual({ kind: "done", provider: "claude_plan" });
    expect(done.result.current.settings.explainer.provider).toBe("claude_plan");
    expect(done.port.start).toHaveBeenCalledTimes(1);

    const stuck = harness();
    stuck.port.startError = "busy";
    stuck.port.polls = [{ stage: "signing_in" }];
    act(() => stuck.result.current.connect.start("chatgpt"));
    await tick(CONNECT_BUSY_RETRY_MS * (CONNECT_BUSY_ATTEMPTS - 1));
    expect(stuck.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
    await tick(CONNECT_BUSY_RETRY_MS);
    expect(stuck.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "provider_unavailable" });
    expect(stuck.port.start).toHaveBeenCalledTimes(1);

    // A second start that fails outright (busy again) lands on provider_unavailable.
    const twice = harness();
    twice.port.startError = "busy";
    twice.port.polls = [{ stage: "failed", outcome: "closed" }];
    act(() => twice.result.current.connect.start("chatgpt"));
    await tick(CONNECT_BUSY_RETRY_MS);
    expect(twice.port.start).toHaveBeenCalledTimes(2);
    expect(twice.result.current.connect.stage).toEqual({ kind: "failed", provider: "chatgpt", outcome: "provider_unavailable" });
  });

  it("starting the other provider while a job runs cancels the running one first; the same provider keeps its job", async () => {
    const h = harness();
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(0);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "chatgpt" });
    // Settings, Change, Connect Claude while the ChatGPT page is open.
    act(() => h.result.current.connect.open({ name: "settings" }));
    act(() => h.result.current.connect.start("claude_plan"));
    await tick(0);
    expect(h.port.cancel).toHaveBeenCalledWith("chatgpt");
    expect(h.port.start).toHaveBeenLastCalledWith("claude_plan");
    const cancelOrder = (h.port.cancel as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0] as number;
    const startOrder = (h.port.start as ReturnType<typeof vi.fn>).mock.invocationCallOrder[1] as number;
    expect(cancelOrder).toBeLessThan(startOrder);
    // The ChatGPT job is no longer polled: a done from it is never adopted.
    h.port.polls = [{ stage: "signing_in" }];
    await tick(CONNECT_POLL_MS);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "claude_plan" });
    expect(h.port.poll).toHaveBeenLastCalledWith("claude_plan");
    // Connect Claude again while its own job runs: no cancel, no second start.
    act(() => h.result.current.connect.open({ name: "settings" }));
    act(() => h.result.current.connect.start("claude_plan"));
    await tick(0);
    expect(h.port.cancel).toHaveBeenCalledTimes(1);
    expect(h.port.start).toHaveBeenCalledTimes(2);
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "claude_plan" });
  });

  it("useThisMac writes apple, shows done and goes back", async () => {
    const h = harness();
    act(() => h.result.current.connect.open({ name: "overview" }));
    act(() => h.result.current.connect.useThisMac());
    expect(h.result.current.connect.stage).toEqual({ kind: "done", provider: "apple" });
    expect(h.result.current.settings.explainer.provider).toBe("apple");
    await tick(AUTO_ADVANCE_MS);
    expect(h.router.back).toHaveBeenCalledTimes(1);
    expect(h.port.start).not.toHaveBeenCalled();
    expect(h.port.cancel).not.toHaveBeenCalled();
    // Chosen while a sign-in runs: that job is cancelled, not left to finish unseen.
    const running = harness();
    running.port.polls = [{ stage: "signing_in" }];
    act(() => running.result.current.connect.start("chatgpt"));
    await tick(0);
    act(() => running.result.current.connect.useThisMac());
    expect(running.port.cancel).toHaveBeenCalledWith("chatgpt");
    expect(running.result.current.connect.stage).toEqual({ kind: "done", provider: "apple" });
  });

  it("a finished Connect or On this Mac turns the AI switch on, so Claude never reads as connected with every surface hidden", async () => {
    const h = harness(GUIDED, { availability: null, aiEnabled: false });
    h.port.polls = [{ stage: "done" }];
    expect(h.result.current.settings.explainer.aiEnabled).toBe(false);
    act(() => h.result.current.connect.open({ name: "settings" }));
    act(() => h.result.current.connect.start("claude_plan"));
    await tick(0);
    expect(h.result.current.connect.stage).toEqual({ kind: "done", provider: "claude_plan" });
    expect(h.result.current.settings.explainer.provider).toBe("claude_plan");
    expect(h.result.current.settings.explainer.aiEnabled).toBe(true);

    const mac = harness(GUIDED, { availability: null, aiEnabled: false });
    act(() => mac.result.current.connect.open({ name: "settings" }));
    act(() => mac.result.current.connect.useThisMac());
    expect(mac.result.current.connect.stage).toEqual({ kind: "done", provider: "apple" });
    expect(mac.result.current.settings.explainer.aiEnabled).toBe(true);
  });

  it("signInAgain opens the connect route, keeps the explain target and starts the current provider", async () => {
    const h = harness({ name: "overview" }, { availability: "needs_sign_in", provider: "claude_plan" });
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.signInAgain({ name: "guided" }, { explainRuleId: "TL-MAC-001" }));
    expect(h.router.navigate).toHaveBeenCalledWith({ name: "connect", returnTo: { name: "guided" } });
    expect(h.result.current.connect.resumeExplain).toBe("TL-MAC-001");
    await tick(0);
    expect(h.port.start).toHaveBeenCalledWith("claude_plan");
    expect(h.result.current.connect.stage).toEqual({ kind: "waiting", provider: "claude_plan" });
    expect(h.result.current.connect.resumeExplain).toBe("TL-MAC-001");
    const plain = harness({ name: "overview" }, { availability: "needs_sign_in", provider: "claude_plan" });
    act(() => plain.result.current.connect.signInAgain({ name: "overview" }));
    expect(plain.router.navigate).toHaveBeenCalledWith({ name: "connect", returnTo: { name: "overview" } });
    expect(plain.result.current.connect.resumeExplain).toBeNull();
    const apple = harness({ name: "overview" }, { availability: null, provider: "apple" });
    act(() => apple.result.current.connect.signInAgain({ name: "overview" }));
    await tick(0);
    expect(apple.port.start).not.toHaveBeenCalled();
  });
});

describe("useAiConnect not now and disconnect", () => {
  it("notNow writes aiAskedAt, clears the resume target and goes back only on the connect route", async () => {
    const h = harness();
    expect(h.result.current.connect.askedRecently).toBe(false);
    act(() => h.result.current.connect.notNow());
    expect(h.result.current.memory.aiAskedAt).toBe(NOW);
    expect(h.result.current.connect.askedRecently).toBe(true);
    expect(h.router.back).not.toHaveBeenCalled();
    act(() => h.result.current.connect.open(GUIDED, { explainRuleId: "TL-MAC-001" }));
    expect(h.router.route.name).toBe("connect");
    act(() => h.result.current.connect.notNow());
    expect(h.router.back).toHaveBeenCalledTimes(1);
    expect(h.router.route).toEqual(GUIDED);
    expect(h.result.current.connect.resumeExplain).toBeNull();
    expect(h.result.current.connect.consumeResume("TL-MAC-001")).toBe(false);
    expect(h.result.current.connect.stage).toEqual({ kind: "choose" });
  });

  it("askedRecently follows the 14 day window", () => {
    const recent = harness(GUIDED, { availability: null, memory: { ...EMPTY_GUIDED_MEMORY, aiAskedAt: "2026-10-03T12:00:00.000Z" } });
    expect(recent.result.current.connect.askedRecently).toBe(true);
    const old = harness(GUIDED, { availability: null, memory: { ...EMPTY_GUIDED_MEMORY, aiAskedAt: "2026-10-01T12:00:00.000Z" } });
    expect(old.result.current.connect.askedRecently).toBe(false);
  });

  it("disconnect clears the current subscription provider's sign-in, probes fresh and resolves true", async () => {
    const h = harness(GUIDED, { availability: "available", provider: "chatgpt" });
    let cleared = false;
    await act(async () => {
      cleared = await h.result.current.connect.disconnect();
    });
    expect(cleared).toBe(true);
    expect(h.port.disconnect).toHaveBeenCalledWith("chatgpt");
    expect(h.probe).toHaveBeenCalledWith(true);
    const apple = harness(GUIDED, { availability: "available", provider: "apple" });
    await act(async () => {
      cleared = await apple.result.current.connect.disconnect();
    });
    expect(cleared).toBe(true);
    expect(apple.port.disconnect).not.toHaveBeenCalled();
    expect(apple.probe).toHaveBeenCalledWith(true);
  });

  it("a disconnect the port refuses resolves false, keeps the probed state and skips the fresh probe", async () => {
    const h = harness(GUIDED, { availability: "available", provider: "claude_plan" });
    (h.port.disconnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("provider_unavailable"));
    let cleared = true;
    await act(async () => {
      cleared = await h.result.current.connect.disconnect();
    });
    expect(cleared).toBe(false);
    expect(h.port.disconnect).toHaveBeenCalledWith("claude_plan");
    // The sign-in is still on this Mac: no outage is reported, so Settings keeps reading "Connected".
    expect(h.report).not.toHaveBeenCalled();
    expect(h.probe).not.toHaveBeenCalled();
  });

  it("a successful connect to another provider clears the previous sign-in; the same provider or On this Mac before it does not", async () => {
    // ChatGPT connected, Claude chosen: the ChatGPT tokens go.
    const switched = harness(GUIDED, { availability: "available", provider: "chatgpt" });
    switched.port.polls = [{ stage: "done" }];
    act(() => switched.result.current.connect.start("claude_plan"));
    await tick(0);
    expect(switched.result.current.settings.explainer.provider).toBe("claude_plan");
    expect(switched.port.disconnect).toHaveBeenCalledTimes(1);
    expect(switched.port.disconnect).toHaveBeenCalledWith("chatgpt");
    // Claude connected, "Use this Mac" chosen: the Claude sign-in goes.
    const mac = harness(GUIDED, { availability: "available", provider: "claude_plan" });
    act(() => mac.result.current.connect.useThisMac());
    await tick(0);
    expect(mac.port.disconnect).toHaveBeenCalledWith("claude_plan");
    // Signing in again to the same provider must not wipe the fresh sign-in.
    const same = harness(GUIDED, { availability: "needs_sign_in", provider: "chatgpt" });
    same.port.polls = [{ stage: "done" }];
    act(() => same.result.current.connect.start("chatgpt"));
    await tick(0);
    expect(same.result.current.settings.explainer.provider).toBe("chatgpt");
    expect(same.port.disconnect).not.toHaveBeenCalled();
    // On this Mac has nothing stored, so nothing to clear.
    const fromApple = harness(GUIDED, { availability: "available", provider: "apple" });
    fromApple.port.polls = [{ stage: "done" }];
    act(() => fromApple.result.current.connect.start("chatgpt"));
    await tick(0);
    expect(fromApple.port.disconnect).not.toHaveBeenCalled();
    // A failing disconnect of the old provider does not block the new one.
    const failing = harness(GUIDED, { availability: "available", provider: "chatgpt" });
    (failing.port.disconnect as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("keychain"));
    failing.port.polls = [{ stage: "done" }];
    act(() => failing.result.current.connect.start("claude_plan"));
    await tick(0);
    expect(failing.result.current.connect.stage).toEqual({ kind: "done", provider: "claude_plan" });
    expect(failing.result.current.settings.explainer.provider).toBe("claude_plan");
  });

  it("stops polling on unmount", async () => {
    const h = harness();
    h.port.polls = [{ stage: "signing_in" }];
    act(() => h.result.current.connect.start("chatgpt"));
    await tick(CONNECT_POLL_MS);
    const polls = (h.port.poll as ReturnType<typeof vi.fn>).mock.calls.length;
    h.unmount();
    await tick(CONNECT_POLL_MS * 3);
    expect(h.port.poll).toHaveBeenCalledTimes(polls);
  });
});
