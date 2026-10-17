import type { Grade } from "../domain/report";
import { WATCH_GRADES, WATCH_REPORT_ID, type WatchReport } from "../ports/watch-port";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scoreValue(score: unknown): number | null {
  if (!isRecord(score)) return null;
  const value = score["value"];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) return null;
  return value;
}

function gradeValue(score: unknown): Grade | null {
  if (!isRecord(score)) return null;
  const grade = score["grade"];
  if (typeof grade !== "string" || !(WATCH_GRADES as readonly string[]).includes(grade)) return null;
  return grade as Grade;
}

/**
 * The window's row from a last-report.json document; mirrors Rust context::report_row. The id
 * and the date decide whether there is a row at all; the nested score.value and score.grade are
 * read leniently, so a malformed score nulls the two fields and never the row.
 */
export function watchReportRow(value: unknown): WatchReport | null {
  if (!isRecord(value)) return null;
  const reportId = value["reportId"];
  if (typeof reportId !== "string" || !WATCH_REPORT_ID.test(reportId)) return null;
  const scannedAt = value["scannedAt"];
  if (typeof scannedAt !== "string" || !Number.isFinite(Date.parse(scannedAt))) return null;
  const score = value["score"];
  return { reportId, scannedAt, score: scoreValue(score), grade: gradeValue(score) };
}
