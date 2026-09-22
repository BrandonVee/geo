import { describe, expect, it } from "vitest";
import {
  assertTrustedWriteOrigin,
  trustedOriginsFrom,
} from "./trusted-origins";

const trustedOrigins = new Set([
  "https://app.example.com",
  "https://console.example.net",
]);

const request = (method: string, headers: Record<string, string> = {}) =>
  new Request("https://app.example.com/api/v1/resource", { method, headers });

describe("trusted browser write origins", () => {
  it("规范化并去重应用、认证和附加可信来源", () => {
    expect([
      ...trustedOriginsFrom({
        APP_URL: "https://app.example.com/",
        BETTER_AUTH_URL: "https://app.example.com",
        BETTER_AUTH_TRUSTED_ORIGINS:
          "https://console.example.net/, https://app.example.com",
      }),
    ]).toEqual(["https://app.example.com", "https://console.example.net"]);
  });

  it("放行读取请求、同源写入和显式配置的跨站来源", () => {
    expect(() =>
      assertTrustedWriteOrigin(
        request("GET", { Origin: "https://untrusted.example.org" }),
        trustedOrigins,
      ),
    ).not.toThrow();
    expect(() =>
      assertTrustedWriteOrigin(
        request("POST", { Origin: "https://app.example.com/" }),
        trustedOrigins,
      ),
    ).not.toThrow();
    expect(() =>
      assertTrustedWriteOrigin(
        request("PATCH", {
          Origin: "https://console.example.net",
          "Sec-Fetch-Site": "cross-site",
        }),
        trustedOrigins,
      ),
    ).not.toThrow();
  });

  it("放行没有浏览器来源信号的服务端调用", () => {
    expect(() =>
      assertTrustedWriteOrigin(request("DELETE"), trustedOrigins),
    ).not.toThrow();
  });

  it.each([
    ["未知来源", { Origin: "https://untrusted.example.org" }],
    ["空来源", { Origin: "null" }],
    ["非法来源", { Origin: "not-a-url" }],
    ["缺少 Origin 的同站请求", { "Sec-Fetch-Site": "same-site" }],
    ["缺少 Origin 的跨站请求", { "Sec-Fetch-Site": "cross-site" }],
  ])("拒绝%s", (_name, headers) => {
    expect(() =>
      assertTrustedWriteOrigin(request("POST", headers), trustedOrigins),
    ).toThrowError(
      expect.objectContaining({ status: 403, code: "UNTRUSTED_ORIGIN" }),
    );
  });
});
