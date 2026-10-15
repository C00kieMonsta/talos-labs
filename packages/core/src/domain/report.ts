import type { Finding, RuleResult, RuleStatus } from "./finding";
import type { Host, SectionKey, UnavailableReason } from "./system-state";

export type Grade = "good" | "fair" | "poor" | "at_risk";

export interface Score {
  /** 0 to 100. null when no rule reached pass, fail or review. */
  readonly value: number | null;
  readonly grade: Grade | null;
  /** Sum of weights over failing rules before the floor and cap. */
  readonly deducted: number;
  /** true when the critical cap lowered the value. */
  readonly cappedByCritical: boolean;
  /** true when no rule is unknown. */
  readonly complete: boolean;
  readonly counts: Readonly<Record<RuleStatus, number>>;
}

export type SectionSummary =
  | { readonly status: "ok" }
  | { readonly status: "unavailable"; readonly reason: UnavailableReason };

export interface ScanReport {
  readonly schemaVersion: 1;
  readonly reportId: string;
  /** ISO 8601. When the engine ran. */
  readonly scannedAt: string;
  /** ISO 8601. When the collector ran. */
  readonly collectedAt: string;
  readonly coreVersion: string;
  readonly catalogVersion: string;
  readonly cisEdition: string;
  readonly platform: Host;
  /** Which sections were collectable. The full SystemState is not stored in the report. */
  readonly sections: Readonly<Record<SectionKey, SectionSummary>>;
  readonly score: Score;
  readonly results: readonly RuleResult[];
  readonly findings: readonly Finding[];
}
