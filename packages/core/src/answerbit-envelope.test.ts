import { describe, expect, it } from "vitest";
import {
  InvalidAnswerBitEnvelopeError,
  parseAnswerBitEnvelope,
} from "./answerbit-envelope";

describe("AnswerBit response envelope", () => {
  it("提取合法 envelope 并移除无关字段", () => {
    expect(
      parseAnswerBitEnvelope({
        code: 0,
        msg: "success",
        data: { brandId: "brand-1" },
        trace: "ignored",
      }),
    ).toEqual({
      code: 0,
      msg: "success",
      data: { brandId: "brand-1" },
    });
  });

  it.each([
    ["空值", null],
    ["数组", []],
    ["缺少 code", { data: null }],
    ["非数字 code", { code: "0", data: null }],
    ["非有限 code", { code: Number.POSITIVE_INFINITY, data: null }],
    ["缺少 data", { code: 0 }],
    ["非字符串 msg", { code: 0, msg: null, data: null }],
  ])("拒绝%s", (_name, value) => {
    expect(() => parseAnswerBitEnvelope(value)).toThrow(
      InvalidAnswerBitEnvelopeError,
    );
  });
});
