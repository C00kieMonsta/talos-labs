import { invoke } from "@tauri-apps/api/core";
import type {
  Arch,
  Evidence,
  EvidenceUnit,
  Finding,
  Host,
  Os,
  ReportStorePort,
  Rule,
  RuleCatalog,
  RuleResult,
  RuleStatus,
  ScanReport,
  SectionKey,
  SectionSummary,
  UnknownReason,
} from "@talos/core";
import { computeScore, headlineFor, sanitiseEvidence, SECTION_KEYS, UNAVAILABLE_REASONS } from "@talos/core";

const STATUSES: readonly RuleStatus[] = ["pass", "fail", "review", "unknown", "not_applicable"];
const UNKNOWN_REASONS: readonly UnknownReason[] = [...UNAVAILABLE_REASONS, "rule_error", "indeterminate"];
const UNITS: readonly EvidenceUnit[] = ["count", "seconds", "hours", "days", "port", "chars"];
const OS_VALUES: readonly Os[] = ["macos", "windows", "linux"];
const ARCH_VALUES: readonly Arch[] = ["arm64", "x86_64"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isEvidence(value: unknown): value is Evidence {
  if (!isRecord(value) || typeof value["key"] !== "string" || typeof value["label"] !== "string") return false;
  const v = value["value"];
  if (!isRecord(v)) return false;
  switch (v["kind"]) {
    case "bool":
      return typeof v["value"] === "boolean";
    case "number":
      return typeof v["value"] === "number" && Number.isFinite(v["value"]) && (v["unit"] === null || isOneOf(v["unit"], UNITS));
    case "enum":
    case "version":
    case "path":
    case "text":
      return typeof v["value"] === "string";
    default:
      return false;
  }
}

/** Keeps only what the engine produced for this rule. null when the entry does not fit. */
function restoreResult(rule: Rule, raw: Record<string, unknown>): RuleResult | null {
  const status = raw["status"];
  const unknownReason = raw["unknownReason"];
  const evidence = raw["evidence"];
  const points = raw["points"];
  if (!isOneOf(status, STATUSES)) return null;
  if (unknownReason !== null && !isOneOf(unknownReason, UNKNOWN_REASONS)) return null;
  if (!Array.isArray(evidence) || !evidence.every(isEvidence)) return null;
  if (typeof points !== "number" || !Number.isFinite(points) || points < 0) return null;
  return { ruleId: rule.id, status, evidence: sanitiseEvidence(rule, evidence), unknownReason, points };
}

/** Only the status and reason survive; collected data never rides along into the report. */
function restoreSection(raw: unknown): SectionSummary | null {
  if (!isRecord(raw)) return null;
  const status = raw["status"];
  const reason = raw["reason"];
  if (status === "ok") return { status: "ok" };
  if (status === "unavailable" && isOneOf(reason, UNAVAILABLE_REASONS)) return { status: "unavailable", reason };
  return null;
}

/** Every section key must be present, since the screens read them without checking. */
function restoreSections(raw: unknown): Record<SectionKey, SectionSummary> | null {
  if (!isRecord(raw)) return null;
  const sections: Partial<Record<SectionKey, SectionSummary>> = {};
  for (const key of SECTION_KEYS) {
    const section = restoreSection(raw[key]);
    if (section === null) return null;
    sections[key] = section;
  }
  return sections as Record<SectionKey, SectionSummary>;
}

function restoreHost(raw: unknown): Host | null {
  if (!isRecord(raw)) return null;
  const os = raw["os"];
  const osVersion = raw["osVersion"];
  const osBuild = raw["osBuild"];
  const arch = raw["arch"];
  const collectorVersion = raw["collectorVersion"];
  if (!isOneOf(os, OS_VALUES) || !isOneOf(arch, ARCH_VALUES)) return null;
  if (typeof osVersion !== "string" || typeof collectorVersion !== "string") return null;
  if (osBuild !== null && typeof osBuild !== "string") return null;
  return { os, osVersion, osBuild, arch, collectorVersion };
}

// Mirrors the engine's toFinding, which core does not export.
function toFinding(rule: Rule, result: RuleResult, status: Finding["status"]): Finding {
  return {
    ruleId: rule.id,
    title: rule.title,
    headline: headlineFor(rule, status),
    severity: rule.severity,
    category: rule.category,
    cis: rule.cis,
    requires: rule.requires,
    status,
    evidence: result.evidence,
    unknownReason: result.unknownReason,
    points: result.points,
    explanation: rule.explanation,
    fix: rule.fix,
  };
}

/**
 * Rebuilds a persisted report from its results and the current catalog. The file supplies the
 * header, the section summaries and, per result, ruleId, status, evidence, unknownReason and
 * points. Every title, explanation and fix comes from the catalog and the score is recomputed,
 * so the file is never a source of command text and nothing the screens read goes unchecked.
 * null when any field is missing or malformed, so the app falls back to the empty state
 * instead of crashing at boot.
 */
export function restoreReport(catalog: RuleCatalog, value: unknown): ScanReport | null {
  if (!isRecord(value) || value["schemaVersion"] !== 1) return null;
  const reportId = value["reportId"];
  const scannedAt = value["scannedAt"];
  const collectedAt = value["collectedAt"];
  const coreVersion = value["coreVersion"];
  const catalogVersion = value["catalogVersion"];
  const cisEdition = value["cisEdition"];
  const rawResults: unknown = value["results"];
  if (typeof reportId !== "string" || !isDateString(scannedAt) || !isDateString(collectedAt)) return null;
  if (typeof coreVersion !== "string" || typeof catalogVersion !== "string" || typeof cisEdition !== "string") return null;
  if (!Array.isArray(rawResults)) return null;
  const platform = restoreHost(value["platform"]);
  const sections = restoreSections(value["sections"]);
  if (platform === null || sections === null) return null;

  const rulesById = new Map<string, Rule>(catalog.rules.map((rule) => [rule.id, rule]));
  const entries: readonly unknown[] = rawResults;
  const rules: Rule[] = [];
  const results: RuleResult[] = [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    if (!isRecord(raw) || typeof raw["ruleId"] !== "string" || seen.has(raw["ruleId"])) return null;
    const rule = rulesById.get(raw["ruleId"]);
    if (rule === undefined) return null;
    const result = restoreResult(rule, raw);
    if (result === null) return null;
    seen.add(rule.id);
    rules.push(rule);
    results.push(result);
    if (result.status === "fail" || result.status === "review" || result.status === "unknown") {
      findings.push(toFinding(rule, result, result.status));
    }
  }
  // computeScore pairs each result with the rule at the same index.
  const score = computeScore(rules, results);
  return {
    schemaVersion: 1,
    reportId,
    scannedAt,
    collectedAt,
    coreVersion,
    catalogVersion,
    cisEdition,
    platform,
    sections,
    score,
    results,
    findings,
  };
}

/** last-report.json in the app data dir, with the latest report kept in memory for the explainer. */
export class FileReportStore implements ReportStorePort {
  private last: ScanReport | null = null;

  constructor(private readonly catalog: RuleCatalog) {}

  async saveLast(report: ScanReport): Promise<void> {
    this.last = report;
    await invoke("report_save_last", { report });
  }

  async loadLast(): Promise<ScanReport | null> {
    const raw = await invoke<unknown>("report_load_last");
    this.last = restoreReport(this.catalog, raw);
    return this.last;
  }

  /** The report most recently saved or loaded in this session, else the one on disk. */
  async current(): Promise<ScanReport | null> {
    if (this.last !== null) return this.last;
    try {
      return await this.loadLast();
    } catch {
      return null;
    }
  }
}
