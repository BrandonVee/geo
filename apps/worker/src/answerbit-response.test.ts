import { answerBitIdResultSchema } from "@geo/contracts";
import { describe, expect, it } from "vitest";
import {
  InvalidAnswerBitDataError,
  parseAnswerBitData,
} from "./answerbit-response";

describe("parseAnswerBitData", () => {
  it("returns normalized schema output", () => {
    expect(parseAnswerBitData(answerBitIdResultSchema, { id: 123 })).toEqual({
      id: "123",
    });
  });

  it("uses a stable error without leaking upstream validation details", () => {
    expect(() => parseAnswerBitData(answerBitIdResultSchema, {})).toThrow(
      InvalidAnswerBitDataError,
    );
  });
});
