import { invoke } from "@tauri-apps/api/core";
import type {
  Evidence,
  EvidenceUnit,
  Finding,
  ReportStorePort,
  Rule,
  RuleCatalog,
  RuleResult,
  RuleStatus,
  ScanReport,
  UnknownReason,
} from "@talos/core";
import { sanitiseEvidence, UNAVAILABLE_REASONS } from "@talos/core";

const STATUSES: readonly RuleStatus[] = ["pass", "fail", "review", "unknown", "not_applicable"];
const UNKNOWN_REASONS: readonly UnknownReason[] = [...UNAVAILABLE_REASONS, "rule_error", "indeterminate"];
const UNITS: readonly EvidenceUnit[] = ["count", "seconds", "hours", "days", "port", "chars"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function looksLikeReport(value: unknown): value is ScanReport {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<ScanReport>;
  return (
    r.schemaVersion === 1 &&
    typeof r.reportId === "string" &&
    Array.isArray(r.results) &&
    Array.isArray(r.findings) &&
    typeof r.score === "object" &&
    r.score !== null
  );
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

// Mirrors the engine's toFinding, which core does not export.
function toFinding(rule: Rule, result: RuleResult, status: Finding["status"]): Finding {
  return {
    ruleId: rule.id,
    title: rule.title,
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
 * Rebuilds a persisted report from its results and the current catalog. The file supplies
 * ruleId, status, evidence, unknownReason and points; every title, explanation and fix comes
 * from the catalog, so the file is never a source of command text. null when any result
 * names a rule the catalog does not have or is malformed.
 */
export function restoreReport(catalog: RuleCatalog, value: unknown): ScanReport | null {
  if (!looksLikeReport(value)) return null;
  const rulesById = new Map<string, Rule>(catalog.rules.map((rule) => [rule.id, rule]));
  const rawResults: readonly unknown[] = value.results;
  const results: RuleResult[] = [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const raw of rawResults) {
    if (!isRecord(raw) || typeof raw["ruleId"] !== "string" || seen.has(raw["ruleId"])) return null;
    const rule = rulesById.get(raw["ruleId"]);
    if (rule === undefined) return null;
    const result = restoreResult(rule, raw);
    if (result === null) return null;
    seen.add(rule.id);
    results.push(result);
    if (result.status === "fail" || result.status === "review" || result.status === "unknown") {
      findings.push(toFinding(rule, result, result.status));
    }
  }
  return { ...value, results, findings };
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
