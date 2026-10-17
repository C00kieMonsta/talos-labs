import type {
  AiAvailability,
  AiAvailabilityDetail,
  Answer,
  AskInput,
  ExplainInput,
  ExplainOptions,
  ExplainerFailure,
  ExplainerPort,
  ExplainerResult,
  Explanation,
  PrioritiseInput,
  Prioritisation,
  RuleCatalog,
} from "@talos/core";
import type { ConnectProvider } from "../scan/ai-connect";
import type { DemoAiConnect } from "./demo-ai-connect";
import { CannedAnswers, DEMO_WORD_CHUNK_MS, streamFields } from "./demo-explainer";
import { recordDemoCall, wait } from "./demo-shared";

export interface DemoProviderOptions {
  readonly catalog: RuleCatalog;
  /** The connect fake that holds this provider's state. */
  readonly connect: DemoAiConnect;
  readonly failure?: ExplainerFailure | null;
  readonly chunkMs?: number;
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

  private chunkMs(): number {
    return this.options.chunkMs ?? DEMO_WORD_CHUNK_MS;
  }
}
