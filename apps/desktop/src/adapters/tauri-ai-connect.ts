import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { AiConnectPort, ConnectOffered, ConnectOutcome, ConnectPoll, ConnectProvider } from "../scan/ai-connect";
import type { InvokeFn } from "./apple-explainer";

const OUTCOMES: readonly ConnectOutcome[] = ["closed", "plan_not_eligible", "provider_unavailable", "timeout", "fetch_failed"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A malformed poll reads as failed/provider_unavailable rather than as a sign-in that never ends. */
export function toConnectPoll(value: unknown): ConnectPoll {
  if (!isRecord(value)) return { stage: "failed", outcome: "provider_unavailable" };
  const stage = value["stage"];
  if (stage === "idle" || stage === "fetching" || stage === "signing_in" || stage === "done") return { stage };
  if (stage === "failed") {
    const outcome = value["outcome"];
    return { stage, outcome: typeof outcome === "string" && (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as ConnectOutcome) : "provider_unavailable" };
  }
  return { stage: "failed", outcome: "provider_unavailable" };
}

export function toConnectOffered(value: unknown): ConnectOffered {
  if (!isRecord(value)) return { chatgpt: false, claude_plan: false, apple: true };
  return { chatgpt: value["chatgpt"] === true, claude_plan: value["claude_plan"] === true, apple: value["apple"] !== false };
}

/** The six connect commands. Rust opens the browser and owns the tokens; the webview only names the provider. */
export class TauriAiConnect implements AiConnectPort {
  private readonly invoke: InvokeFn;

  constructor(invoke?: InvokeFn) {
    this.invoke = invoke ?? ((cmd, args) => tauriInvoke<unknown>(cmd, args));
  }

  async offered(): Promise<ConnectOffered> {
    try {
      return toConnectOffered(await this.invoke("ai_connect_offered", {}));
    } catch {
      return { chatgpt: false, claude_plan: false, apple: true };
    }
  }

  async start(provider: ConnectProvider): Promise<ConnectPoll> {
    let seeded: unknown;
    try {
      seeded = await this.invoke("ai_connect_start", { provider });
    } catch (error) {
      throw new Error(typeof error === "string" ? error : "provider_unavailable");
    }
    return toConnectPoll(seeded);
  }

  async poll(provider: ConnectProvider): Promise<ConnectPoll> {
    try {
      return toConnectPoll(await this.invoke("ai_connect_poll", { provider }));
    } catch {
      return { stage: "failed", outcome: "provider_unavailable" };
    }
  }

  async cancel(provider: ConnectProvider): Promise<void> {
    await this.invoke("ai_connect_cancel", { provider }).catch(() => undefined);
  }

  async disconnect(provider: ConnectProvider): Promise<void> {
    try {
      await this.invoke("ai_disconnect", { provider });
    } catch (error) {
      throw new Error(typeof error === "string" ? error : "provider_unavailable");
    }
  }
}
