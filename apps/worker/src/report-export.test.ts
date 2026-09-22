import { describe, expect, it } from "vitest";
import {
  InvalidReportExportFiltersError,
  parseReportExportFilters,
  ReportExportBuffer,
  ReportExportTooLargeError,
} from "./report-export";

describe("report export boundaries", () => {
  it("normalizes stored filters with contract defaults", () => {
    expect(
      parseReportExportFilters({
        beginDate: "2026-09-01",
        endDate: "2026-09-23",
      }),
    ).toEqual({
      beginDate: "2026-09-01",
      endDate: "2026-09-23",
      platforms: [],
      promptIds: [],
      tagIds: [],
      titleIds: [],
    });
  });

  it.each([
    null,
    { beginDate: "invalid", endDate: "2026-09-23" },
    { beginDate: "2026-09-24", endDate: "2026-09-23" },
    { beginDate: "2026-09-01", endDate: "2026-09-23", extra: true },
  ])("rejects invalid stored filters", (value) => {
    expect(() => parseReportExportFilters(value)).toThrow(
      InvalidReportExportFiltersError,
    );
  });

  it("caps rows before serializing the CSV", () => {
    const buffer = new ReportExportBuffer(2, 1024);
    buffer.append([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(buffer.toCsv()).toMatchObject({ rowCount: 2 });
    expect(buffer.toCsv().fileContent).not.toContain("3");
  });

  it("rejects cumulative source data over the byte limit", () => {
    const buffer = new ReportExportBuffer(10, 20);
    expect(() => buffer.append([{ value: "a".repeat(30) }])).toThrow(
      ReportExportTooLargeError,
    );
  });

  it("checks final UTF-8 CSV bytes including headers and BOM", () => {
    const buffer = new ReportExportBuffer(10, 40);
    buffer.append([{ a: { x: '"'.repeat(10) } }]);
    expect(() => buffer.toCsv()).toThrowError("REPORT_EXPORT_TOO_LARGE");
  });
});
