import {
  reportExportFiltersSchema,
  type ReportExportFilters,
} from "@geo/contracts";
import { recordsToCsv } from "@geo/core";

export const maxReportExportRows = 10_000;
export const maxReportExportBytes = 16 * 1024 * 1024;

export class InvalidReportExportFiltersError extends Error {
  constructor() {
    super("INVALID_REPORT_EXPORT_FILTERS");
    this.name = "InvalidReportExportFiltersError";
  }
}

export class ReportExportTooLargeError extends Error {
  constructor() {
    super("REPORT_EXPORT_TOO_LARGE");
    this.name = "ReportExportTooLargeError";
  }
}

export function parseReportExportFilters(value: unknown): ReportExportFilters {
  const parsed = reportExportFiltersSchema.safeParse(value);
  if (!parsed.success) throw new InvalidReportExportFiltersError();
  return parsed.data;
}

export class ReportExportBuffer {
  private readonly bufferedRows: Record<string, unknown>[] = [];
  private sourceBytes = 2;

  constructor(
    private readonly maxRows = maxReportExportRows,
    private readonly maxBytes = maxReportExportBytes,
  ) {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1)
      throw new Error("REPORT_EXPORT_MAX_ROWS_INVALID");
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
      throw new Error("REPORT_EXPORT_MAX_BYTES_INVALID");
  }

  get rowCount(): number {
    return this.bufferedRows.length;
  }

  get full(): boolean {
    return this.rowCount >= this.maxRows;
  }

  append(rows: readonly Record<string, unknown>[]): void {
    for (const row of rows) {
      if (this.full) return;
      const serialized = JSON.stringify(row);
      const rowBytes = Buffer.byteLength(serialized, "utf8");
      const separatorBytes = this.rowCount > 0 ? 1 : 0;
      if (this.sourceBytes + separatorBytes + rowBytes > this.maxBytes)
        throw new ReportExportTooLargeError();
      this.sourceBytes += separatorBytes + rowBytes;
      this.bufferedRows.push(row);
    }
  }

  toCsv(): { fileContent: string; rowCount: number } {
    const fileContent = recordsToCsv(this.bufferedRows);
    if (Buffer.byteLength(fileContent, "utf8") > this.maxBytes)
      throw new ReportExportTooLargeError();
    return { fileContent, rowCount: this.rowCount };
  }
}
