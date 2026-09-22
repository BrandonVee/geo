import { describe, expect, it } from "vitest";
import { NO_STORE_CACHE_CONTROL } from "@/server/http/cache";
import { GET } from "./route";

describe("liveness", () => {
  it("返回存活状态且禁止缓存", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(NO_STORE_CACHE_CONTROL);
    expect(await response.json()).toMatchObject({
      data: { status: "ok" },
      requestId: expect.any(String),
    });
  });
});
