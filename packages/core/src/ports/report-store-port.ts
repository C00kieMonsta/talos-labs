import type { ScanReport } from "../domain/report";

export interface ReportStorePort {
  saveLast(report: ScanReport): Promise<void>;
  loadLast(): Promise<ScanReport | null>;
}
