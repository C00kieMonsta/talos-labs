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
  validateExplanation,
  validatePrioritisation,
  validateAnswer,
  containsCommandText,
  clampQuestion,
  clampHistory,
  ON_DEVICE_LIMITS,
  buildOnDeviceInstructions,
  buildOnDevicePrompt,
} from "./explainer/index";
export type { OnDevicePrompt, OnDeviceTask, OnDeviceExtra } from "./explainer/index";

export { parseLicense, entitled, freeFixRuleIds, FREE_FIX_COUNT, LICENSE_PREFIX, LICENSE_PRODUCT } from "./license/index";

export { buildGuidedPlan, planLocked, convertedShowStep, nextAction, LEFT_ALONE, WATCH_EVERY_MS, diffReports, EMPTY_GUIDED_MEMORY, parseGuidedMemory } from "./guided/index";
export type { GuidedStep, GuidedPlan, GuidedGate, NextAction, NextActionKind, ReportDiff, GuidedMemory, PermissionKind } from "./guided/index";

export { DEV_MACHINE, HARDENED, ALL_UNAVAILABLE, FRESH_INSTALL, WINDOWS_MINIMAL, FIXTURES } from "./fixtures/index";
