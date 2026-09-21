import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createBrand: vi.fn() }));

vi.mock("@/server/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("@/server/audit/write-audit", () => ({
  auditContextFromRequest: vi.fn().mockReturnValue({ requestId: "request-1" }),
}));
vi.mock("@/server/http/errors", () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    errorResponse(error: unknown, requestId: string) {
      const apiError = error as ApiError;
      return Response.json(
        {
          error: { code: apiError.code, message: apiError.message },
          requestId,
        },
        { status: apiError.status },
      );
    },
  };
});
vi.mock("@/server/services/platform-answerbit", () => ({
  platformAnswerbitService: { createBrand: mocks.createBrand },
}));

import { POST } from "./route";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("平台腾讯品牌创建接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createBrand.mockResolvedValue({
      brandId: "brand-1",
      brandName: "测试品牌",
    });
  });

  it("接受签名匹配的 Logo 并返回资源位置", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/admin/answerbit-brands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brand: "测试品牌",
          iconMimeType: "image/png",
          iconData: pngBase64,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBe(
      "/api/v1/admin/answerbit-brands/brand-1",
    );
    expect(mocks.createBrand).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "测试品牌",
        iconMimeType: "image/png",
        iconData: pngBase64,
      }),
      "user-1",
      expect.anything(),
    );
  });

  it("拒绝 Logo 声明格式与文件签名不一致", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/admin/answerbit-brands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brand: "测试品牌",
          iconMimeType: "image/gif",
          iconData: pngBase64,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Logo 图片内容与声明的文件格式不匹配",
      },
    });
    expect(mocks.createBrand).not.toHaveBeenCalled();
  });
});
