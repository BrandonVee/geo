import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
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
vi.mock("@/server/services/brands", () => ({
  brandService: { list: vi.fn() },
}));

import { PATCH } from "./[brandId]/route";
import { POST } from "./route";

describe("租户腾讯品牌写入口", () => {
  it("创建入口固定返回 410，避免绕过平台企业管理", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/answerbit/brands", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ANSWERBIT_BRAND_PLATFORM_MANAGED" },
    });
  });

  it("修改入口固定返回 410，避免租户修改腾讯企业资料", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/v1/answerbit/brands/brand-1", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ANSWERBIT_BRAND_PLATFORM_MANAGED" },
    });
  });
});
