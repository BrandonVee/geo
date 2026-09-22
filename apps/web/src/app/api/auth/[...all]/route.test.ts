import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/server/auth/auth", () => ({ auth: {} }));
vi.mock("@/server/env", () => ({
  getServerEnv: () => ({
    APP_URL: "https://geo.test",
    BETTER_AUTH_URL: "https://geo.test",
    BETTER_AUTH_TRUSTED_ORIGINS: "",
  }),
}));
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

  it("在进入认证适配器前拒绝超限正文", async () => {
    const request = new Request("https://geo.test/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "Content-Length": String(4 * 1024 * 1024 + 1),
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    const response = await POST(request);

    expect(mocks.post).not.toHaveBeenCalled();
    expect(response.status).toBe(413);
    expect(response.headers.get("X-Request-ID")).toBe("auth-request-1");
    expect(await response.json()).toEqual({
      error: { code: "PAYLOAD_TOO_LARGE", message: "请求体不能超过 4 MiB" },
      requestId: "auth-request-1",
    });
  });

  it("在读取正文前拒绝不可信的浏览器来源", async () => {
    const request = new Request("https://geo.test/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "Content-Length": String(4 * 1024 * 1024 + 1),
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
      },
      body: "{}",
    });

    const response = await POST(request);

    expect(mocks.post).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Request-ID")).toBe("auth-request-1");
    expect(await response.json()).toEqual({
      error: { code: "UNTRUSTED_ORIGIN", message: "请求来源不受信任" },
      requestId: "auth-request-1",
    });
  });

  it("将限长后可重放的正文传给认证适配器", async () => {
    mocks.post.mockImplementation(async (request: Request) => {
      expect(request.headers.get("Content-Length")).toBe("56");
      expect(await request.json()).toEqual({
        username: "smoke_user",
        password: "SmokePassword123!",
      });
      return Response.json({ token: "session" });
    });
    const request = new Request("https://geo.test/api/auth/sign-in/username", {
      method: "POST",
      headers: {
        "Content-Length": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "smoke_user",
        password: "SmokePassword123!",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-ID")).toBe("auth-request-1");
    expect(await response.json()).toEqual({ token: "session" });
  });
});
