import { describe, expect, it } from "vitest";
import { answerBitArticleCreatePayloadSchema } from "./index";

const validPayload = {
  brand_id: "brand-1",
  template_type: 1,
  prompt_ids: ["prompt-1"],
  knowledge_ids: [],
  tag_ids: [],
  language: "zh-CN",
};

describe("AnswerBit operation payload contracts", () => {
  it("accepts the canonical article creation payload", () => {
    expect(answerBitArticleCreatePayloadSchema.parse(validPayload)).toEqual(
      validPayload,
    );
  });

  it.each([
    { ...validPayload, brand_id: "" },
    { ...validPayload, template_type: 0 },
    { ...validPayload, prompt_ids: [] },
    { ...validPayload, language: "unsupported" },
    { ...validPayload, unexpected: true },
    { ...validPayload, high_ref: { title: "missing content" } },
  ])("rejects an invalid article creation payload", (payload) => {
    expect(answerBitArticleCreatePayloadSchema.safeParse(payload).success).toBe(
      false,
    );
  });
});
