import { describe, expect, it } from "vitest";
import { ApiError, errorResponse } from "@/server/http/errors";
import { AnswerBitError } from "@/server/integrations/answerbit/errors";
import { mapUpstreamError } from "./answerbit-connections";

describe("AnswerBit upstream error mapping", () => {
  it("将上游限流等待时间作为标准 Retry-After 返回", async () => {
    let mapped: unknown;
    try {
      mapUpstreamError(
        new AnswerBitError(
          "rate_limited",
          "/geo/query/brand",
          429,
          undefined,
          2_001,
        ),
      );
    } catch (error) {
      mapped = error;
    }

    expect(mapped).toBeInstanceOf(ApiError);
    const response = errorResponse(mapped, "request-1");
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3");
    expect(await response.json()).toMatchObject({
      error: {
        code: "ANSWERBIT_RATE_LIMITED",
        details: {
          operation: "/geo/query/brand",
          httpStatus: 429,
        },
      },
      requestId: "request-1",
    });
  });

  it("非限流错误不附加 Retry-After", () => {
    let mapped: unknown;
    try {
      mapUpstreamError(
        new AnswerBitError(
          "upstream",
          "/geo/query/brand",
          503,
          undefined,
          2_000,
        ),
      );
    } catch (error) {
      mapped = error;
    }

    const response = errorResponse(mapped, "request-2");
    expect(response.status).toBe(502);
    expect(response.headers.has("Retry-After")).toBe(false);
  });
});
