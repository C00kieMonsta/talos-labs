import type { AiConnectPort, ConnectOffered, ConnectPoll, ConnectProvider } from "../scan/ai-connect";

/**
 * A build that offers no subscription route: only On this Mac is offered and every start is
 * refused. The real build wires TauriAiConnect and the demo DemoAiConnect in its place.
 */
export class NotOfferedConnect implements AiConnectPort {
  async offered(): Promise<ConnectOffered> {
    return { chatgpt: false, claude_plan: false, apple: true };
  }

  async start(_provider: ConnectProvider): Promise<ConnectPoll> {
    throw new Error("not_offered");
  }

  async poll(_provider: ConnectProvider): Promise<ConnectPoll> {
    return { stage: "idle" };
  }

  async cancel(_provider: ConnectProvider): Promise<void> {
    return undefined;
  }

  async disconnect(_provider: ConnectProvider): Promise<void> {
    return undefined;
  }
}
