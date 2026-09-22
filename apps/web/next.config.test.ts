import { describe, expect, it } from "vitest";
import nextConfig, { buildContentSecurityPolicy } from "./next.config";

describe("Next.js response headers", () => {
  const scriptDirective = (policy: string) =>
    policy
      .split(";")
      .find((directive) => directive.trim().startsWith("script-src ")) ?? "";

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
      "upgrade-insecure-requests",
    ])
      expect(policy).toContain(directive);
    expect(policy).not.toContain("'unsafe-eval'");
    expect(scriptDirective(policy)).not.toContain("'unsafe-inline'");
  });

  it("页面 CSP 只允许携带当前 nonce 的脚本", () => {
    const policy = buildContentSecurityPolicy(true, "bm9uY2U=");

    expect(policy).toContain(
      "script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic'",
    );
    expect(scriptDirective(policy)).not.toContain("'unsafe-inline'");
    expect(buildContentSecurityPolicy(true, "bad nonce")).not.toContain(
      "'nonce-",
    );
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
