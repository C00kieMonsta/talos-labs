export { CORE_VERSION } from "./version";

export * from "./domain/system-state";
export * from "./domain/finding";
export * from "./domain/rule";
export * from "./domain/report";
export { assertSystemState, isSystemState, SystemStateGuardError, UNAVAILABLE_REASONS } from "./domain/system-state.guard";
export { toCapabilities, AUTOMATION_STATUSES } from "./domain/capabilities.guard";

export * from "./ports/system-state-port";
export * from "./ports/explainer-port";
export * from "./ports/fix-port";
export * from "./ports/license-port";
export * from "./ports/secret-store-port";
export * from "./ports/report-store-port";
export * from "./ports/watch-port";

export { evaluate, evaluateRule, sanitiseEvidence } from "./engine/evaluate";
export { computeScore, gradeFor, pointsFor, CRITICAL_CAP } from "./engine/score";
export { reportIdFor } from "./engine/report-id";
export { headlineFor, unknownHeadline } from "./engine/headline";

export { MACOS_CATALOG, MACOS_CATALOG_VERSION, MACOS_CIS_EDITION } from "./rules/macos/index";

export {
  toExplainerContext,
  explainerEligibleRuleIds,
  buildSystemPrompt,
  EXPLANATION_JSON_SCHEMA,
  PRIORITISATION_JSON_SCHEMA,
  ANSWER_JSON_SCHEMA,
  WATCH_JSON_SCHEMA,
  CHAT_JSON_SCHEMA,
  validateChat,
  validateChatAnswer,
  claimsAppIdentity,
  claimsAction,
  replyRejected,
  containsMachineText,
  CHAT_LIMITS,
  clampChatHistory,
  clampChatQuestion,
  toWatchContext,
  WATCH_RULE_ID,
  buildOnDeviceWatchPrompt,
  buildOnDeviceWatchInstructions,
  validateExplanation,
  validatePrioritisation,
  validateAnswer,
  containsCommandText,
  clampQuestion,
  clampHistory,
  ON_DEVICE_LIMITS,
  ON_DEVICE_CHAT_LIMITS,
  ON_DEVICE_CHAT_SENTENCE,
  buildOnDeviceInstructions,
  buildOnDeviceChatInstructions,
  buildOnDevicePrompt,
  explainTurns,
  prioritiseTurns,
  askTurns,
  watchTurns,
  chatTurns,
  WATCH_INSTRUCTIONS_BLOCK,
  buildWatchInstructions,
  CHAT_INSTRUCTIONS_BLOCK,
  plainNamesBlock,
  buildChatInstructions,
  watchRequestBody,
  claudePromptFor,
  strictSchema,
  responsesRequestBody,
  RESPONSES_MAX_OUTPUT_TOKENS,
  CHATGPT_MODEL_PATTERN,
  DEFAULT_CHATGPT_MODEL,
  completeJsonPrefix,
  splitSseEvents,
  parseResponsesEvent,
  parseResponsesError,
} from "./explainer/index";
export type { KnownRules, ChatHistoryTarget, OnDevicePrompt, OnDeviceTask, OnDeviceExtra, RemoteTask, RemoteTurn, ResponsesRequest, ResponsesOptions, ResponsesEvent, ResponsesError, WatchContextInput, WatchOnDevicePrompt } from "./explainer/index";

export { parseLicense, entitled, freeFixRuleIds, FREE_FIX_COUNT, LICENSE_PREFIX, LICENSE_PRODUCT } from "./license/index";

export { buildGuidedPlan, planLocked, convertedShowStep, nextAction, LEFT_ALONE, WATCH_EVERY_MS, diffReports, EMPTY_GUIDED_MEMORY, parseGuidedMemory, AI_ASK_AGAIN_MS, aiAskedRecently, AI_LAST_AVAILABLE_TTL_MS, aiAvailableRecently } from "./guided/index";
export type { GuidedStep, GuidedPlan, GuidedGate, NextAction, NextActionKind, ReportDiff, GuidedMemory, PermissionKind, AiLastAvailable, AiProviderId } from "./guided/index";

export * from "./activity/index";

export * from "./chat/index";

export * from "./watch/index";

export { DEV_MACHINE, HARDENED, ALL_UNAVAILABLE, FRESH_INSTALL, WINDOWS_MINIMAL, FIXTURES } from "./fixtures/index";

export { LATER_ASK_COUNT, KEEP_ACCEPTED_THROUGH_PASS, isAccepted, acceptedFailing, acceptRules, unacceptRule, clearAcceptedThatPass } from "./guided/index";
export { REMINDER_HOUR, reminderDate, remindRules, reminderDue, clearReminders, dueFirst } from "./guided/index";
export { ACCEPTED_SENTENCE, buildExplainerSystemPrompt, ON_DEVICE_BASE_INSTRUCTIONS } from "./explainer/index";
