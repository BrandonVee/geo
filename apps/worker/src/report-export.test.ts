import { describe, expect, it } from "vitest";
import {
  InvalidReportExportFiltersError,
  parseReportExportFilters,
  reportExportPayload,
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
      mentionBrand: -1,
    });
  });

  it("exports the same answer keyword, mention and model filters as the visible list", () => {
    const filters = parseReportExportFilters({
      beginDate: "2026-09-01",
      endDate: "2026-09-23",
      keyword: "选购",
      mentionBrand: 0,
      platforms: ["deepseek"],
      titleIds: ["title"],
    });
    expect(reportExportPayload("answers", "brand", filters, 2)).toMatchObject({
      brand_id: "brand",
      prompt: "选购",
      mention_brand: 0,
      platforms: ["deepseek"],
      title_id: ["title"],
      page: 2,
      page_size: 100,
    });
    expect(
      reportExportPayload("domain_rank", "brand", filters, 1),
    ).toMatchObject({ domain: "选购", title_ids: ["title"] });
    expect(
      reportExportPayload("article_rank", "brand", filters, 1),
    ).toMatchObject({ keyword: "选购", title_ids: ["title"] });
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
