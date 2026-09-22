import { beforeEach, describe, expect, it, vi } from "vitest";
import { NO_STORE_CACHE_CONTROL } from "@/server/http/cache";

const mocks = vi.hoisted(() => ({
  isInitialized: vi.fn(),
}));

vi.mock("@/server/modules/identity/identity.service", () => ({
  identityService: {
    isInitialized: mocks.isInitialized,
  },
}));

import { GET } from "./route";

describe("bootstrap status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("返回初始化状态且禁止缓存", async () => {
    mocks.isInitialized.mockResolvedValue(true);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(NO_STORE_CACHE_CONTROL);
    expect(await response.json()).toMatchObject({
      data: { initialized: true },
      requestId: expect.any(String),
    });
  });

  it("查询失败时错误响应同样禁止缓存", async () => {
    mocks.isInitialized.mockRejectedValue(new Error("database unavailable"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe(NO_STORE_CACHE_CONTROL);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
      requestId: expect.any(String),
    });
  });
});
