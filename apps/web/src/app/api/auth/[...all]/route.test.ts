import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({ auth: {} }));
vi.mock("@geo/core", () => ({ createRequestId: () => "auth-request-1" }));
vi.mock("better-auth/next-js", () => ({
  toNextJsHandler: () => ({ GET: mocks.get, POST: mocks.post }),
}));

import { POST } from "./route";

describe("Better Auth route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("将限流兼容头同时公开为标准 Retry-After", async () => {
    mocks.post.mockResolvedValue(
      Response.json(
        { code: "TOO_MANY_REQUESTS" },
        { status: 429, headers: { "X-Retry-After": "60" } },
      ),
    );
    const request = new Request("https://geo.test/api/auth/sign-in/username", {
      method: "POST",
    });

    const response = await POST(request);

    expect(mocks.post).toHaveBeenCalledWith(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("X-Request-ID")).toBe("auth-request-1");
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toEqual({ code: "TOO_MANY_REQUESTS" });
  });

  it("将认证适配器的意外异常转换为带关联标识的稳定错误", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.post.mockRejectedValue(new Error("auth database unavailable"));
    const request = new Request("https://geo.test/api/auth/sign-in/username", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-ID")).toBe("auth-request-1");
    expect(await response.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" },
      requestId: "auth-request-1",
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('"event":"request.failed"'),
    );
    log.mockRestore();
  });
});
