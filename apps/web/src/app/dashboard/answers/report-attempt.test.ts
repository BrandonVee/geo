import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ReportAttempt } from "./report-attempt";
const storage = new Map<string, string>();
const key = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (id: string) => storage.get(id) ?? null,
    setItem: (id: string, value: string) => storage.set(id, value),
    removeItem: (id: string) => storage.delete(id),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("报告网络重试", () => {
  it("失败和刷新保留原键，确认成功才结束一次提交", () => {
    const request = new ReportAttempt("user.org.brand.answers");
    expect(request.key({ keyword: "选购" }, () => key)).toBe(key);
    expect(
      new ReportAttempt("user.org.brand.answers").key({ keyword: "选购" }),
    ).toBe(key);
    request.complete();
    expect(storage.size).toBe(0);
    expect(
      new ReportAttempt("user.org.brand.answers").key({ keyword: "选购" }),
    ).not.toBe(key);
  });
  it("更换筛选、操作者或范围使用新的提交键", () => {
    const request = new ReportAttempt("user.org.brand.answers");
    request.key({ keyword: "选购" }, () => key);
    expect(request.key({ keyword: "其他" })).not.toBe(key);
    expect(
      new ReportAttempt("other.org.brand.answers").key({ keyword: "选购" }),
    ).not.toBe(key);
  });
  it("损坏或禁用存储不阻止导出", () => {
    storage.set("test", "invalid JSON");
    expect(new ReportAttempt("test").key({})).toBeTruthy();
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
    });
    const request = new ReportAttempt("test");
    expect(request.key({})).toBeTruthy();
    expect(() => request.complete()).not.toThrow();
  });
});
