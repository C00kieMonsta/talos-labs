import type {
  AiAvailability,
  Answer,
  AskInput,
  ExplainInput,
  ExplainerPort,
  ExplainerResult,
  Explanation,
  PrioritiseInput,
  Prioritisation,
} from "@talos/core";

/** AI switched off. The app is complete without a model. */
export class NoExplainer implements ExplainerPort {
  readonly id = "none" as const;

  async availability(_fresh?: boolean): Promise<AiAvailability> {
    return "off";
  }

  async explain(_input: ExplainInput): Promise<ExplainerResult<Explanation>> {
    return { ok: false, reason: "not_configured" };
  }

  async prioritise(_input: PrioritiseInput): Promise<ExplainerResult<Prioritisation>> {
    return { ok: false, reason: "not_configured" };
  }

  async ask(_input: AskInput): Promise<ExplainerResult<Answer>> {
    return { ok: false, reason: "not_configured" };
  }
}

/** Claude selected but no key in the keychain yet. */
export class NoApiKeyExplainer implements ExplainerPort {
  readonly id = "claude" as const;

  async availability(_fresh?: boolean): Promise<AiAvailability> {
    return "available";
  }

  async explain(_input: ExplainInput): Promise<ExplainerResult<Explanation>> {
    return { ok: false, reason: "no_api_key" };
  }

  async prioritise(_input: PrioritiseInput): Promise<ExplainerResult<Prioritisation>> {
    return { ok: false, reason: "no_api_key" };
  }

  async ask(_input: AskInput): Promise<ExplainerResult<Answer>> {
    return { ok: false, reason: "no_api_key" };
  }
}
