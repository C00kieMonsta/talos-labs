/**
 * Plain JSON Schema documents for the five model outputs.
 * Shared by the Claude and Ollama adapters; no zod here so core stays dependency-free.
 */

import { INTENT_KINDS, REMIND_WHENS } from "../chat/intents";

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

const WATCH_ID = { type: "string", minLength: 1, maxLength: 48 } as const;

/** The watch verdict. Rust ai::schemas::WATCH is the one-line equivalent. */
export const WATCH_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["rating", "ratingReason", "basedOn", "probes", "actions"],
  properties: {
    rating: { type: "string", enum: ["calm", "keep_an_eye", "act_now"] },
    ratingReason: { type: "string", maxLength: 120 },
    basedOn: { type: "array", maxItems: 6, items: WATCH_ID },
    probes: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["probeId", "reason"],
        properties: { probeId: WATCH_ID, reason: { type: "string", maxLength: 300 } },
      },
    },
    actions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["actionId", "sentence"],
        properties: { actionId: WATCH_ID, sentence: { type: "string", maxLength: 300 } },
      },
    },
  },
};

const INTENT = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "ruleId", "signalId", "when"],
  properties: {
    kind: { type: "string", enum: [...INTENT_KINDS] },
    ruleId: { type: ["string", "null"], minLength: 1, maxLength: 32 },
    signalId: { type: ["string", "null"], minLength: 1, maxLength: 48 },
    when: { type: ["string", "null"], enum: [...REMIND_WHENS, null] },
  },
} as const;

/** The chat task. Rust ai::schemas::CHAT is the one-line equivalent; fixtures/explainer-schemas.json pins it last. */
export const CHAT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "relatedRuleIds", "outsideScope", "intents"],
  properties: {
    reply: { type: "string" },
    relatedRuleIds: RULE_ID_LIST,
    outsideScope: { type: "boolean" },
    intents: { type: "array", maxItems: 3, items: INTENT },
  },
};
