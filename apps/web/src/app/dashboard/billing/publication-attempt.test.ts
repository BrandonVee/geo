import { describe, expect, it } from "vitest";
import { PublicationAttempt } from "./publication-attempt";
describe("发布请求幂等键", () => {
  it("网络失败重试沿用原键，成功确认后才创建新键", () => {
    const attempt = new PublicationAttempt();
    const payload = { brandId: "brand", title: "title" };
    expect(attempt.key(payload, () => "key-1")).toBe("key-1");
    expect(attempt.key(payload, () => "key-2")).toBe("key-1");
    attempt.complete();
    expect(attempt.key(payload, () => "key-2")).toBe("key-2");
  });
  it("不同内容或品牌使用独立键", () => {
    const attempt = new PublicationAttempt();
    attempt.key({ brandId: "a" }, () => "key-1");
    expect(attempt.key({ brandId: "b" }, () => "key-2")).toBe("key-2");
  });
});
