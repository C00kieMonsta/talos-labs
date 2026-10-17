import type { AiAvailability, AiAvailabilityDetail } from "@talos/core";
import type { AiConnectPort, ConnectOffered, ConnectOutcome, ConnectPoll, ConnectProvider } from "../scan/ai-connect";
import type { ExplainerProvider } from "../settings";
import { recordDemoCall, wait } from "./demo-shared";

export type DemoConnectOutcome = "ok" | "closed" | "plan_not_eligible" | "unavailable" | "timeout" | "fetch_failed";
export const DEMO_CONNECT_OUTCOMES: readonly DemoConnectOutcome[] = ["ok", "closed", "plan_not_eligible", "unavailable", "timeout", "fetch_failed"];

export const DEFAULT_CONNECT_DELAY_MS = 1500;

export interface DemoAiConnectOptions {
  /** The provider the URL seeded; its fake explainer starts in `ai`. */
  readonly provider?: ExplainerProvider;
  readonly ai?: AiAvailability;
  readonly aiUntil?: string;
  readonly connect?: DemoConnectOutcome;
  readonly connectDelayMs?: number;
  /** The Claude sign-in shows the fetching stage first. */
  readonly claudeFetch?: boolean;
}

const PROVIDERS: readonly ConnectProvider[] = ["chatgpt", "claude_plan"];

/** A seeded state that means a sign-in exists on this Mac. */
function impliesConnected(state: AiAvailability): boolean {
  return state !== "not_connected" && state !== "not_offered" && state !== "connecting";
}

function isConnectProvider(provider: ExplainerProvider | undefined): provider is ConnectProvider {
  return provider === "chatgpt" || provider === "claude_plan";
}

interface ProviderState {
  detail: AiAvailabilityDetail;
  connected: boolean;
  readonly offered: boolean;
  poll: ConnectPoll;
}

/**
 * The browser-only sign-in: no page opens, the stages play out on timers and the outcome
 * comes from the URL. The fake explainers read their availability from here, so a connect
 * done in the demo turns the provider available at once.
 */
export class DemoAiConnect implements AiConnectPort {
  private readonly states: Record<ConnectProvider, ProviderState>;
  private readonly appleOffered: boolean;
  private readonly outcome: DemoConnectOutcome;
  private readonly delayMs: number;
  private readonly claudeFetch: boolean;
  private running: { provider: ConnectProvider; controller: AbortController } | null = null;

  constructor(options: DemoAiConnectOptions = {}) {
    const seeded = isConnectProvider(options.provider) ? options.provider : null;
    const seededState = options.ai ?? "not_connected";
    const states = {} as Record<ConnectProvider, ProviderState>;
    for (const provider of PROVIDERS) {
      const state = provider === seeded ? seededState : "not_connected";
      states[provider] = {
        detail: { state, until: state === "limit_reached" ? (options.aiUntil ?? null) : null },
        connected: impliesConnected(state),
        offered: state !== "not_offered",
        poll: { stage: "idle" },
      };
    }
    this.states = states;
    this.appleOffered = !(options.provider === "apple" && options.ai === "device_not_eligible");
    this.outcome = options.connect ?? "ok";
    this.delayMs = options.connectDelayMs ?? DEFAULT_CONNECT_DELAY_MS;
    this.claudeFetch = options.claudeFetch === true;
  }

  /** What the fake explainer for `provider` reports. */
  detail(provider: ConnectProvider): AiAvailabilityDetail {
    return this.states[provider].detail;
  }

  isConnected(provider: ConnectProvider): boolean {
    return this.states[provider].connected;
  }

  async offered(): Promise<ConnectOffered> {
    return { chatgpt: this.states.chatgpt.offered, claude_plan: this.states.claude_plan.offered, apple: this.appleOffered };
  }

  async start(provider: ConnectProvider): Promise<ConnectPoll> {
    recordDemoCall({ kind: "aiConnectStart", arg: provider });
    const state = this.states[provider];
    if (!state.offered) throw new Error("not_offered");
    if (this.running !== null) throw new Error("busy");
    const controller = new AbortController();
    this.running = { provider, controller };
    state.detail = { state: "connecting", until: null };
    state.poll = { stage: this.claudeFetch && provider === "claude_plan" ? "fetching" : "signing_in" };
    void this.run(provider, state, controller.signal);
    return state.poll;
  }

  private async run(provider: ConnectProvider, state: ProviderState, signal: AbortSignal): Promise<void> {
    try {
      if (state.poll.stage === "fetching") {
        await wait(this.delayMs, signal);
        if (this.outcome === "fetch_failed") return this.settle(provider, state, "fetch_failed");
        state.poll = { stage: "signing_in" };
      }
      await wait(this.delayMs, signal);
    } catch {
      // Cancelled: settle() already ran.
      return;
    }
    this.settle(provider, state, this.outcome);
  }

  private settle(provider: ConnectProvider, state: ProviderState, outcome: DemoConnectOutcome | "fetch_failed"): void {
    if (this.running?.provider === provider) this.running = null;
    if (outcome === "ok") {
      state.connected = true;
      state.detail = { state: "available", until: null };
      state.poll = { stage: "done" };
      return;
    }
    const failed: ConnectOutcome = outcome === "unavailable" ? "provider_unavailable" : outcome;
    state.connected = false;
    state.detail = {
      state: failed === "plan_not_eligible" ? "plan_not_eligible" : failed === "provider_unavailable" ? "provider_unavailable" : "not_connected",
      until: null,
    };
    state.poll = { stage: "failed", outcome: failed };
  }

  async poll(provider: ConnectProvider): Promise<ConnectPoll> {
    return this.states[provider].poll;
  }

  async cancel(provider: ConnectProvider): Promise<void> {
    recordDemoCall({ kind: "aiConnectCancel", arg: provider });
    const job = this.running;
    if (job === null || job.provider !== provider) return;
    this.settle(provider, this.states[provider], "closed");
    job.controller.abort();
  }

  async disconnect(provider: ConnectProvider): Promise<void> {
    recordDemoCall({ kind: "aiDisconnect", arg: provider });
    const state = this.states[provider];
    state.connected = false;
    state.detail = { state: "not_connected", until: null };
    state.poll = { stage: "idle" };
  }
}
