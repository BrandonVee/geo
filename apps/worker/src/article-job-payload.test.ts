import { describe, expect, it, vi } from "vitest";
import {
  InvalidArticleJobPayloadError,
  parseArticleJobPayload,
} from "./article-job-payload";

const payload = {
  brand_id: "brand-1",
  template_type: 2,
  prompt_ids: ["prompt-1"],
  knowledge_ids: [],
  tag_ids: [],
  language: "zh-CN",
};
const expected = {
  brandId: "brand-1",
  templateType: 2,
  language: "zh-CN",
};

describe("parseArticleJobPayload", () => {
  it("decrypts and validates a stored job payload", () => {
    expect(
      parseArticleJobPayload(
        { ciphertext: "encrypted" },
        () => JSON.stringify(payload),
        expected,
      ),
    ).toEqual(payload);
  });

  it("rejects unexpected envelope fields before decrypting", () => {
    const decrypt = vi.fn(() => JSON.stringify(payload));
    expect(() =>
      parseArticleJobPayload(
        { ciphertext: "encrypted", plaintext: payload },
        decrypt,
        expected,
      ),
    ).toThrow(InvalidArticleJobPayloadError);
    expect(decrypt).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", () => "{"],
    ["invalid operation fields", () => JSON.stringify({ brand_id: "brand-1" })],
    [
      "mismatched tenant brand",
      () => JSON.stringify({ ...payload, brand_id: "brand-2" }),
    ],
    [
      "mismatched immutable template",
      () => JSON.stringify({ ...payload, template_type: 3 }),
    ],
    [
      "mismatched immutable language",
      () => JSON.stringify({ ...payload, language: "en-US" }),
    ],
  ])("uses a stable error for %s", (_name, decrypt) => {
    expect(() =>
      parseArticleJobPayload({ ciphertext: "encrypted" }, decrypt, expected),
    ).toThrowError("INVALID_ARTICLE_JOB_PAYLOAD");
  });
});
