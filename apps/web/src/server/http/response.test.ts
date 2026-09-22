import { describe, expect, it } from "vitest";
import { apiJson, emptyResponse, withRequestId } from "./response";

describe("API responses", () => {
  it("JSON 响应头使用与响应体一致的 requestId", async () => {
    const response = apiJson(
      { data: { value: 1 }, requestId: "request-1" },
      { status: 201, headers: { Location: "/resource/1" } },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("X-Request-ID")).toBe("request-1");
    expect(response.headers.get("Location")).toBe("/resource/1");
    expect(await response.json()).toEqual({
      data: { value: 1 },
      requestId: "request-1",
    });
  });

  it("没有请求标识的非平台 JSON 不伪造响应头", () => {
    const response = apiJson({ data: null });

    expect(response.headers.has("X-Request-ID")).toBe(false);
  });

  it("空响应保留状态、调用方响应头和 requestId", () => {
    const response = emptyResponse("request-2", {
      status: 204,
      headers: { "X-Result": "deleted" },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("X-Request-ID")).toBe("request-2");
    expect(response.headers.get("X-Result")).toBe("deleted");
    expect(emptyResponse("request-3").status).toBe(204);
  });

  it("为第三方响应补充 requestId 且保留正文和原响应头", async () => {
    const source = Response.json(
      { code: "AUTH_FAILED" },
      { status: 401, headers: { "X-Auth-Source": "better-auth" } },
    );
    source.headers.append(
      "Set-Cookie",
      "session=one; Path=/; HttpOnly; SameSite=Lax",
    );
    source.headers.append(
      "Set-Cookie",
      "csrf=two; Path=/; HttpOnly; SameSite=Lax",
    );

    const response = withRequestId(source, "request-4");

    expect(response.status).toBe(401);
    expect(response.headers.get("X-Request-ID")).toBe("request-4");
    expect(response.headers.get("X-Auth-Source")).toBe("better-auth");
    expect(response.headers.getSetCookie()).toEqual([
      "session=one; Path=/; HttpOnly; SameSite=Lax",
      "csrf=two; Path=/; HttpOnly; SameSite=Lax",
    ]);
    expect(await response.json()).toEqual({ code: "AUTH_FAILED" });
  });
});
