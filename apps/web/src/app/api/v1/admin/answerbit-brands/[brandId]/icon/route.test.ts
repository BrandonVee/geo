import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateBrandIcon: vi.fn() }));

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
  platformAnswerbitService: { updateBrandIcon: mocks.updateBrandIcon },
}));

import { PUT } from "./route";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("平台腾讯品牌 Logo 接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateBrandIcon.mockResolvedValue({
      brandId: "brand-1",
      iconUrl: "https://static.test/logo.png",
    });
  });

  it("校验参数后调用品牌 Logo 业务服务", async () => {
    const response = await PUT(
      new Request(
        "http://localhost/api/v1/admin/answerbit-brands/brand-1/icon",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            iconMimeType: "image/png",
            iconData: pngBase64,
          }),
        },
      ),
      { params: Promise.resolve({ brandId: "brand-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.updateBrandIcon).toHaveBeenCalledWith(
      "brand-1",
      { iconMimeType: "image/png", iconData: pngBase64 },
      "user-1",
      expect.anything(),
    );
  });

  it("拒绝非图片 MIME", async () => {
    const response = await PUT(
      new Request(
        "http://localhost/api/v1/admin/answerbit-brands/brand-1/icon",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            iconMimeType: "application/pdf",
            iconData: "base64",
          }),
        },
      ),
      { params: Promise.resolve({ brandId: "brand-1" }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.updateBrandIcon).not.toHaveBeenCalled();
  });

  it("拒绝与 MIME 不匹配的伪造图片", async () => {
    const response = await PUT(
      new Request(
        "http://localhost/api/v1/admin/answerbit-brands/brand-1/icon",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            iconMimeType: "image/gif",
            iconData: pngBase64,
          }),
        },
      ),
      { params: Promise.resolve({ brandId: "brand-1" }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Logo 图片内容与声明的文件格式不匹配",
      },
    });
    expect(mocks.updateBrandIcon).not.toHaveBeenCalled();
  });

  it("按解码后的原始字节拒绝超过 2MB 的图片", async () => {
    const response = await PUT(
      new Request(
        "http://localhost/api/v1/admin/answerbit-brands/brand-1/icon",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            iconMimeType: "image/png",
            iconData: Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
          }),
        },
      ),
      { params: Promise.resolve({ brandId: "brand-1" }) },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Logo 原始文件不能超过 2MB",
      },
    });
    expect(mocks.updateBrandIcon).not.toHaveBeenCalled();
  });
});
