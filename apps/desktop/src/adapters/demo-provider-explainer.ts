import type {
  AiAvailability,
  AiAvailabilityDetail,
  Answer,
  AskInput,
  ExplainInput,
  ExplainOptions,
  ExplainerFailure,
  ExplainerPort,
  ChatCall,
  ChatResult,
  ExplainerResult,
  Explanation,
  PrioritiseInput,
  Prioritisation,
  RuleCatalog,
} from "@talos/core";
import type { ConnectProvider } from "../scan/ai-connect";
import type { DemoAiConnect } from "./demo-ai-connect";
import { validateChat } from "@talos/core";
import { CannedAnswers, DEMO_WORD_CHUNK_MS, chatStreamExtras, knownRulesFor, streamFields, type DemoChatOptions } from "./demo-explainer";
import { recordDemoCall, wait } from "./demo-shared";
import { chatPartialOptions } from "./explainer-shared";

export interface DemoProviderOptions {
  readonly catalog: RuleCatalog;
  /** The connect fake that holds this provider's state. */
  readonly connect: DemoAiConnect;
  readonly failure?: ExplainerFailure | null;
  readonly chunkMs?: number;
  readonly chat?: DemoChatOptions;
}

/** The fake ChatGPT or Claude: availability follows the demo connect, answers stream word by word. */
export class DemoProviderExplainer implements ExplainerPort {
  private readonly canned: CannedAnswers;

  constructor(
    readonly id: ConnectProvider,
    private readonly options: DemoProviderOptions,
  ) {
    this.canned = new CannedAnswers(options.catalog);
  }

  async availability(_fresh?: boolean): Promise<AiAvailability> {
    return this.options.connect.detail(this.id).state;
  }

  async availabilityDetail(_fresh?: boolean): Promise<AiAvailabilityDetail> {
    return this.options.connect.detail(this.id);
  }

  private async gate(): Promise<ExplainerFailure | null> {
    const failure = this.options.failure;
    if (failure !== undefined && failure !== null) return failure;
    const state = await this.availability();
    if (state === "available") return null;
    if (state === "needs_sign_in" || state === "limit_reached" || state === "provider_unavailable") return state;
    return "not_configured";
  }

  async explain(input: ExplainInput, options?: ExplainOptions<Explanation>): Promise<ExplainerResult<Explanation>> {
    const blocked = await this.gate();
    if (blocked !== null) return { ok: false, reason: blocked };
    return streamFields(this.canned.explanation(input), ["ruleId", "whyItMattersForYou", "whatCouldHappen", "urgency"], this.chunkMs(), options);
  }

  async prioritise(input: PrioritiseInput, options?: ExplainOptions<Prioritisation>): Promise<ExplainerResult<Prioritisation>> {
    const blocked = await this.gate();
    if (blocked !== null) return { ok: false, reason: blocked };
    try {
      await wait(this.chunkMs() * 12, options?.signal);
    } catch {
      recordDemoCall({ kind: "aiCancel" });
      return { ok: false, reason: "cancelled" };
    }
    return { ok: true, value: this.canned.prioritisation(input) };
  }

  async ask(input: AskInput, options?: ExplainOptions<Answer>): Promise<ExplainerResult<Answer>> {
    const blocked = await this.gate();
    if (blocked !== null) return { ok: false, reason: blocked };
    return streamFields(this.canned.answer(input), ["answer", "relatedRuleIds", "outsideScope"], this.chunkMs(), options);
  }

  /** Streams the canned ChatResult word by word; the prose check runs on every partial and the validator on the whole. */
  async chat(call: ChatCall, options?: ExplainOptions<ChatResult>): Promise<ExplainerResult<ChatResult>> {
    const blocked = await this.gate();
    if (blocked !== null) return { ok: false, reason: blocked };
    const chat = this.options.chat ?? {};
    if (chat.fail !== undefined && chat.fail !== null && !(typeof chat.failAfter === "number" && chat.failAfter > 0)) return { ok: false, reason: chat.fail };
    const value = this.canned.chat(call.input, chat.reply ?? "disk");
    const result = await streamFields(value, ["reply", "relatedRuleIds", "outsideScope", "intents"], this.chunkMs(), chatPartialOptions(options) as ExplainOptions<Record<string, unknown>>, chatStreamExtras(chat));
    if (!result.ok) return result;
    return validateChat(result.value, knownRulesFor(call), call.allowed, call.locked);
  }

  private chunkMs(): number {
    return this.options.chunkMs ?? DEMO_WORD_CHUNK_MS;
  }
}
