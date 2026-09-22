import { describe, expect, it } from "vitest";
import nextConfig, { buildContentSecurityPolicy } from "./next.config";

describe("Next.js response headers", () => {
  it("所有 API 响应都禁止浏览器和共享代理缓存", async () => {
    const rules = await nextConfig.headers?.();
    const apiRule = rules?.find((rule) => rule.source === "/api/:path*");

    expect(apiRule?.headers).toContainEqual({
      key: "Cache-Control",
      value: "no-store, max-age=0",
    });
  });

  it("生产 CSP 限制执行、嵌入和外连且不开放 eval", () => {
    const policy = buildContentSecurityPolicy(true);

    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "object-src 'none'",
      "script-src-attr 'none'",
      "connect-src 'self'",
    ])
      expect(policy).toContain(directive);
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("开发 CSP 仅为热更新开放 eval 与本地连接", async () => {
    const developmentPolicy = buildContentSecurityPolicy(false);
    const rules = await nextConfig.headers?.();
    const globalRule = rules?.find((rule) => rule.source === "/(.*)");

    expect(developmentPolicy).toContain("'unsafe-eval'");
    expect(developmentPolicy).toContain("ws: wss: http: https:");
    expect(globalRule?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: developmentPolicy,
    });
    expect(globalRule?.headers).toContainEqual({
      key: "Cross-Origin-Resource-Policy",
      value: "same-origin",
    });
  });
});
