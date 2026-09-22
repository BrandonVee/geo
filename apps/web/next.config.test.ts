import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("Next.js response headers", () => {
  it("所有 API 响应都禁止浏览器和共享代理缓存", async () => {
    const rules = await nextConfig.headers?.();
    const apiRule = rules?.find((rule) => rule.source === "/api/:path*");

    expect(apiRule?.headers).toContainEqual({
      key: "Cache-Control",
      value: "no-store, max-age=0",
    });
  });
});
