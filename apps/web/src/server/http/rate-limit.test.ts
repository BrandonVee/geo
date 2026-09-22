import { describe, expect, it } from "vitest";
import { normalizeRetryAfterHeader, retryAfterSeconds } from "./rate-limit";

describe("rate limit response headers", () => {
  it("将毫秒等待时间向上取整为 Retry-After 秒数", () => {
    expect(retryAfterSeconds(0)).toBe("0");
    expect(retryAfterSeconds(1)).toBe("1");
    expect(retryAfterSeconds(2_001)).toBe("3");
    expect(retryAfterSeconds(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(retryAfterSeconds(-1)).toBeUndefined();
  });

  it("将 Better Auth 的兼容头规范化为标准 Retry-After", async () => {
    const response = normalizeRetryAfterHeader(
      Response.json(
        { code: "TOO_MANY_REQUESTS" },
        { status: 429, headers: { "X-Retry-After": "42" } },
      ),
    );

    expect(response.headers.get("Retry-After")).toBe("42");
    expect(response.headers.get("X-Retry-After")).toBe("42");
    expect(await response.json()).toEqual({ code: "TOO_MANY_REQUESTS" });
  });

  it("不信任非数字兼容头且不覆盖已有标准头", () => {
    const invalid = normalizeRetryAfterHeader(
      new Response(null, {
        status: 429,
        headers: { "X-Retry-After": "soon" },
      }),
    );
    const standard = normalizeRetryAfterHeader(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "60", "X-Retry-After": "10" },
      }),
    );

    expect(invalid.headers.has("Retry-After")).toBe(false);
    expect(standard.headers.get("Retry-After")).toBe("60");
  });
});
