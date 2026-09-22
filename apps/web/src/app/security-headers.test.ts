import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Web 安全响应头", () => {
  it("为所有页面配置浏览器隔离与信息泄露防护", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toBeDefined();
    const global = rules?.find((rule) => rule.source === "/(.*)");
    const headers = Object.fromEntries(
      global?.headers.map(({ key, value }) => [key.toLowerCase(), value]) ?? [],
    );

    expect(headers).toMatchObject({
      "cross-origin-opener-policy": "same-origin",
      "origin-agent-cluster": "?1",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-dns-prefetch-control": "off",
      "x-frame-options": "DENY",
      "x-permitted-cross-domain-policies": "none",
    });
  });
});
