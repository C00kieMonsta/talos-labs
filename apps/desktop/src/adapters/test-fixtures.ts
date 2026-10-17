import type {
  ChatCall,
  ChatInput,
  ExplainerContext,
  Finding,
  Fix,
  RuleResult,
  ScanReport,
  SectionKey,
  SectionSummary,
} from "@talos/core";
import { EMPTY_GUIDED_MEMORY, SECTION_KEYS, buildAllowed, buildGuidedPlan, freeFixRuleIds, lockedFor, toAllowedInput } from "@talos/core";

const FIX: Fix = {
  summary: "Turn the setting on.",
  settingsPath: ["System Settings", "Privacy & Security"],
  settingsPane: "security",
  commands: [],
  steps: ["Open System Settings.", "Turn the setting on."],
  verify: null,
  effort: "two_minutes",
  sideEffects: "none",
  apply: { kind: "in_app", choice: "none", passphrase: false, needsPassword: true, recheck: ["firewall"], confirmTitle: "Turn it on?", confirmVerb: "Turn on", confirmNote: null, reversible: null },
};

function finding(
  ruleId: Finding["ruleId"],
  status: Finding["status"],
  severity: Finding["severity"],
  category: Finding["category"],
  points: number,
): Finding {
  return {
    ruleId,
    title: `Rule ${ruleId}`,
    headline: status === "unknown" ? `Couldn't check rule ${ruleId}` : `Rule ${ruleId} fails`,
    guided: { headline: "Fix this", why: "It matters.", verb: "Fix it for me", done: "Done. Fixed.", where: null },
    severity,
    category,
    cis: null,
    requires: ["firewall"],
    status,
    evidence: [{ key: "enabled", label: "Enabled", value: { kind: "bool", value: false } }],
    unknownReason: null,
    points,
    explanation: "Authored explanation.",
    fix: FIX,
  };
}

const FINDINGS: readonly Finding[] = [
  finding("TL-MAC-001", "fail", "critical", "encryption", 20),
  finding("TL-MAC-002", "fail", "high", "network", 8),
  finding("TL-MAC-023", "review", "info", "persistence", 0),
];

const PASSES: readonly RuleResult[] = (["TL-MAC-003", "TL-MAC-004"] as const).map((ruleId) => ({
  ruleId,
  status: "pass",
  evidence: [],
  unknownReason: null,
  points: 0,
}));

const RESULTS: readonly RuleResult[] = [
  ...FINDINGS.map(
    (f): RuleResult => ({
      ruleId: f.ruleId,
      status: f.status,
      evidence: f.evidence,
      unknownReason: f.unknownReason,
      points: f.points,
    }),
  ),
  ...PASSES,
];

const SECTIONS = Object.fromEntries(
  SECTION_KEYS.map((key) => [key, { status: "ok" } satisfies SectionSummary]),
) as Record<SectionKey, SectionSummary>;

/** A small but complete report: two failures (one critical, so the score is capped), one review, two passes. */
export const TEST_REPORT: ScanReport = {
  schemaVersion: 1,
  reportId: "01TESTREPORT",
  scannedAt: "2026-10-15T10:00:00.000Z",
  collectedAt: "2026-10-15T09:59:00.000Z",
  coreVersion: "0.1.0",
  catalogVersion: "0.2.0",
  cisEdition: "CIS Apple macOS 26 Tahoe Benchmark v1.0.0",
  platform: { os: "macos", osVersion: "27.0.1", osBuild: null, arch: "arm64", collectorVersion: "0.1.0" },
  sections: SECTIONS,
  score: {
    value: 59,
    grade: "poor",
    deducted: 28,
    cappedByCritical: true,
    complete: true,
    counts: { pass: 2, fail: 2, review: 1, unknown: 0, not_applicable: 0 },
  },
  results: RESULTS,
  findings: FINDINGS,
};

export const TEST_CONTEXT: ExplainerContext = {
  schemaVersion: 1,
  os: "macos",
  osVersion: "27.0.1",
  profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true },
  score: 59,
  counts: TEST_REPORT.score.counts,
  findings: FINDINGS.map((f) => ({
    ruleId: f.ruleId,
    status: f.status,
    severity: f.severity,
    category: f.category,
    points: f.points,
    evidence: [{ key: "enabled", value: false }],
    accepted: false,
  })),
};

export const VALID_EXPLANATION = {
  ruleId: "TL-MAC-001",
  whyItMattersForYou: "Anyone who picks up the laptop can read your files.",
  whatCouldHappen: "A lost laptop becomes a data leak.",
  urgency: "today",
} as const;

export const VALID_PRIORITISATION = {
  order: ["TL-MAC-001", "TL-MAC-002", "TL-MAC-023"],
  reasons: [{ ruleId: "TL-MAC-001", reason: "Encryption protects everything else." }],
  startWith: ["TL-MAC-001"],
} as const;

export const VALID_ANSWER = {
  answer: "Turn on FileVault first, then the firewall.",
  relatedRuleIds: ["TL-MAC-001", "TL-MAC-002"],
  outsideScope: false,
} as const;

/** One chat turn on TEST_REPORT: the plan and allow-lists from the real builders, licensed, the scan ready, the watch on. */
export const TEST_CHAT_CALL: ChatCall = (() => {
  const gate = { freeFixes: freeFixRuleIds(TEST_REPORT), licensed: true };
  const plan = buildGuidedPlan(TEST_REPORT, gate, TEST_CONTEXT.profile, EMPTY_GUIDED_MEMORY, TEST_REPORT.scannedAt);
  const allowed = buildAllowed({ plan, report: TEST_REPORT, gate, scanReady: true, watchEnabled: true, memory: EMPTY_GUIDED_MEMORY, doneStepIds: [] });
  const stepRuleIds = plan.steps.flatMap((step) => (step.kind === "batch" ? [step.ruleIds[0] ?? "TL-MAC-002"] : step.kind === "fix" || step.kind === "show" ? [step.ruleId] : []));
  const input: ChatInput = {
    context: TEST_CONTEXT,
    history: [],
    question: "Why does the disk matter?",
    plan: { stepRuleIds, fixed: [], later: plan.later, accepted: plan.accepted, leftAlone: plan.leftAlone },
    allowed: toAllowedInput(allowed),
    events: [],
    watch: { enabled: true, rating: "calm", lastCheckMinutesAgo: null, items: [] },
  };
  return { input, allowed, locked: lockedFor(plan, gate) };
})();

/** A chat reply whose one intent is the first allowed show or fix id, so it survives the validator on TEST_REPORT. */
export const VALID_CHAT = (() => {
  const { allowed } = TEST_CHAT_CALL;
  const showId = allowed.show[0];
  const fixId = allowed.fix[0];
  const intents = showId !== undefined ? [{ kind: "show_where", ruleId: showId, signalId: null, when: null }] : fixId !== undefined ? [{ kind: "fix_rule", ruleId: fixId, signalId: null, when: null }] : [];
  return { reply: "Your disk is not locked. Start from the button below.", relatedRuleIds: ["TL-MAC-001"], outsideScope: false, intents } as const;
})();
