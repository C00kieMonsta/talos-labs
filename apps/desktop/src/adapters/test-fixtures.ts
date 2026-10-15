import type {
  ExplainerContext,
  Finding,
  Fix,
  RuleResult,
  ScanReport,
  SectionKey,
  SectionSummary,
} from "@talos/core";
import { SECTION_KEYS } from "@talos/core";

const FIX: Fix = {
  summary: "Turn the setting on.",
  settingsPath: ["System Settings", "Privacy & Security"],
  settingsPane: "security",
  commands: [],
  steps: ["Open System Settings.", "Turn the setting on."],
  verify: null,
  effort: "two_minutes",
  sideEffects: "none",
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

/** A small but complete report: two failures, one review, two passes. */
export const TEST_REPORT: ScanReport = {
  schemaVersion: 1,
  reportId: "01TESTREPORT",
  scannedAt: "2026-10-15T10:00:00.000Z",
  collectedAt: "2026-10-15T09:59:00.000Z",
  coreVersion: "0.1.0",
  catalogVersion: "0.1.0",
  cisEdition: "CIS Apple macOS 26 Tahoe Benchmark v1.0.0",
  platform: { os: "macos", osVersion: "27.0.1", osBuild: null, arch: "arm64", collectorVersion: "0.1.0" },
  sections: SECTIONS,
  score: {
    value: 72,
    grade: "fair",
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
  score: 72,
  counts: TEST_REPORT.score.counts,
  findings: FINDINGS.map((f) => ({
    ruleId: f.ruleId,
    status: f.status,
    severity: f.severity,
    category: f.category,
    points: f.points,
    evidence: [{ key: "enabled", value: false }],
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
