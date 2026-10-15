/**
 * Plain JSON Schema documents for the three model outputs.
 * Shared by the Claude and Ollama adapters; no zod here so core stays dependency-free.
 */

const RULE_ID = { type: "string", minLength: 1, maxLength: 32 } as const;

const RULE_ID_LIST = { type: "array", items: RULE_ID } as const;

export const EXPLANATION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["ruleId", "whyItMattersForYou", "whatCouldHappen", "urgency"],
  properties: {
    ruleId: RULE_ID,
    whyItMattersForYou: { type: "string" },
    whatCouldHappen: { type: "string" },
    urgency: { type: "string", enum: ["today", "this_week", "when_convenient"] },
  },
};

export const PRIORITISATION_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["order", "reasons", "startWith"],
  properties: {
    order: RULE_ID_LIST,
    reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ruleId", "reason"],
        properties: {
          ruleId: RULE_ID,
          reason: { type: "string" },
        },
      },
    },
    startWith: RULE_ID_LIST,
  },
};

export const ANSWER_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "relatedRuleIds", "outsideScope"],
  properties: {
    answer: { type: "string" },
    relatedRuleIds: RULE_ID_LIST,
    outsideScope: { type: "boolean" },
  },
};
