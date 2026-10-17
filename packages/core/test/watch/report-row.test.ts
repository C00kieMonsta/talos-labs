import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_ROW_CASES } from "../../src/watch/cases";
import { watchReportRow } from "../../src/watch/report-row";

const FIXTURE = join(__dirname, "..", "..", "fixtures", "watch-cases.json");

describe("watchReportRow", () => {
  it("every case answers as recorded", () => {
    for (const c of REPORT_ROW_CASES) expect(watchReportRow(c.report), c.name).toEqual(c.row);
  });

  it("the fixture carries the cases", () => {
    const cases = JSON.parse(readFileSync(FIXTURE, "utf8")) as { reportRows: typeof REPORT_ROW_CASES };
    expect(cases.reportRows).toEqual(JSON.parse(JSON.stringify(REPORT_ROW_CASES)));
    expect(cases.reportRows.map((c) => c.name)).toEqual([
      "a real report gives the flat row",
      "a null score value and grade give null fields",
      "a bare number for score nulls the fields, not the row",
      "a score value over 100 is null",
      "a grade outside the four words is null",
      "a report id with a space and a bang is no row",
      "a report id of 65 characters is no row",
      "a scannedAt that does not parse is no row",
      "no report id is no row",
    ]);
  });

  it("the first case is a real evaluate() report with the nested score", () => {
    const first = REPORT_ROW_CASES[0];
    const report = first?.report as { schemaVersion: number; score: { value: number; grade: string; counts: unknown } };
    expect(report.schemaVersion).toBe(1);
    expect(report.score.value).toBe(72);
    expect(report.score.grade).toBe("fair");
    expect(report.score.counts).toBeDefined();
    expect(first?.row).toEqual({ reportId: "r-1", scannedAt: "2026-10-17T11:30:00.000Z", score: 72, grade: "fair" });
  });

  it("reads the nested score leniently and the id and date strictly", () => {
    const base = { reportId: "r.1_x-2", scannedAt: "2026-10-17T11:30:00.000Z" };
    expect(watchReportRow({ ...base, score: { value: 0, grade: "at_risk" } })).toEqual({ ...base, score: 0, grade: "at_risk" });
    expect(watchReportRow({ ...base, score: { value: 100, grade: "good" } })).toEqual({ ...base, score: 100, grade: "good" });
    expect(watchReportRow({ ...base, score: { value: 72.5, grade: "fair" } })).toEqual({ ...base, score: null, grade: "fair" });
    expect(watchReportRow({ ...base, score: { value: -1, grade: 3 } })).toEqual({ ...base, score: null, grade: null });
    expect(watchReportRow({ ...base, score: "72" })).toEqual({ ...base, score: null, grade: null });
    expect(watchReportRow({ ...base })).toEqual({ ...base, score: null, grade: null });
    expect(watchReportRow({ ...base, reportId: "r".repeat(64) })).not.toBeNull();
    expect(watchReportRow({ ...base, reportId: "" })).toBeNull();
    expect(watchReportRow({ ...base, reportId: 7 })).toBeNull();
    expect(watchReportRow({ ...base, scannedAt: 1 })).toBeNull();
    for (const bad of [null, undefined, 1, "r-1", [], []]) expect(watchReportRow(bad)).toBeNull();
  });
});
