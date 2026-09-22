import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const nonceFrom = (policy: string) => policy.match(/'nonce-([^']+)'/)?.[1];
const scriptDirective = (policy: string) =>
  policy
    .split(";")
    .find((directive) => directive.trim().startsWith("script-src ")) ?? "";

describe("HTML CSP proxy", () => {
  it("为页面响应和下游渲染请求注入同一个一次性 nonce", () => {
    const response = proxy(new NextRequest("https://app.example.com/setup"));
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    const nonce = nonceFrom(policy);

    expect(nonce).toBeTruthy();
    expect(policy).toContain("'strict-dynamic'");
    expect(scriptDirective(policy)).not.toContain("'unsafe-inline'");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);
  });

  it("不同页面请求使用不同 nonce", () => {
    const first = proxy(new NextRequest("https://app.example.com/setup"));
    const second = proxy(new NextRequest("https://app.example.com/setup"));

    expect(
      nonceFrom(first.headers.get("Content-Security-Policy") ?? ""),
    ).not.toBe(nonceFrom(second.headers.get("Content-Security-Policy") ?? ""));
  });
});
