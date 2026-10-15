import { invoke } from "@tauri-apps/api/core";
import type { ReportStorePort, ScanReport } from "@talos/core";

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

/** last-report.json in the app data dir, with the latest report kept in memory for the explainer. */
export class FileReportStore implements ReportStorePort {
  private last: ScanReport | null = null;

  async saveLast(report: ScanReport): Promise<void> {
    this.last = report;
    await invoke("report_save_last", { report });
  }

  async loadLast(): Promise<ScanReport | null> {
    const raw = await invoke<unknown>("report_load_last");
    this.last = looksLikeReport(raw) ? raw : null;
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
