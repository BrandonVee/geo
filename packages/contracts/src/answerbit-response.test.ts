import { describe, expect, it } from "vitest";
import {
  answerBitArticleContentSchema,
  answerBitBrandListSchema,
  answerBitDashboardMetricsSchema,
  answerBitTaskListSchema,
} from "./answerbit-response";

describe("AnswerBit shared response contracts", () => {
  it("normalizes numeric identifiers used by web and worker consumers", () => {
    expect(
      answerBitBrandListSchema.parse([{ id: 42, brand_name: "Acme" }]),
    ).toEqual([{ id: "42", brand_name: "Acme" }]);
  });

  it("rejects incomplete dashboard metrics", () => {
    expect(
      answerBitDashboardMetricsSchema.safeParse({
        exposure: { value: 1, fluctuation: 0 },
        score: { value: 2, fluctuation: 1 },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed report rows instead of passing them to CSV export", () => {
    expect(
      answerBitTaskListSchema.safeParse({
        scores: [{ task_id: "task-only" }],
        total: 1,
      }).success,
    ).toBe(false);
  });

  it("requires complete generated article content", () => {
    expect(
      answerBitArticleContentSchema.safeParse({
        article_id: "article-1",
        brand_id: "brand-1",
        title: "Title",
        main_body: "Body",
      }).success,
    ).toBe(false);
  });
});
