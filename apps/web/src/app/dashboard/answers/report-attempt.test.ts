import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createReportExportSchema } from "@geo/contracts";
import type { ReportAttempt as Attempt } from "./report-attempt";
let ReportAttempt: typeof Attempt;
const storage = new Map<string, string>();
const key = "11111111-1111-4111-8111-111111111111";
const input = createReportExportSchema.parse({
  organizationId: "22222222-2222-4222-8222-222222222222",
  teamBindingId: "33333333-3333-4333-8333-333333333333",
  brandId: "brand-a",
  reportType: "answers",
  beginDate: "2026-09-01",
  endDate: "2026-09-30",
  keyword: "原条件",
  mentionBrand: 1,
});
const { organizationId, teamBindingId, brandId, reportType } = input;
const scope = { organizationId, teamBindingId, brandId, reportType };
beforeEach(async () => {
  storage.clear();
  vi.resetModules();
  ({ ReportAttempt } = await import("./report-attempt"));
  vi.stubGlobal("sessionStorage", {
    getItem: (id: string) => storage.get(id) ?? null,
    setItem: (id: string, value: string) => storage.set(id, value),
    removeItem: (id: string) => storage.delete(id),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("报告原提交恢复", () => {
  it("改筛选、日期、报告内容和刷新不会替换未确认的原请求", async () => {
    const request = new ReportAttempt("test", scope);
    const first = request.begin(input, () => key);
    request.settle(key);
    const retry = request.begin({
      ...input,
      keyword: "新条件",
      endDate: "2026-10-01",
    });
    expect(retry).toEqual(first);
    request.settle(key);
    vi.resetModules();
    const Fresh = (await import("./report-attempt")).ReportAttempt;
    const refreshed = new Fresh("test", scope);
    expect(refreshed.pending).toEqual(first);
    expect(refreshed.begin({ ...input, keyword: "刷新后新条件" })).toEqual(
      first,
    );
    refreshed.complete(key);
    expect(storage.size).toBe(0);
    expect(refreshed.begin(input).key).not.toBe(key);
  });
  it("同一页面切回原品牌时仍保护执行中的请求，旧结果不结束新提交", () => {
    const request = new ReportAttempt("test", scope);
    request.begin(input, () => key);
    const reopened = new ReportAttempt("test", scope);
    expect(reopened.inFlight).toBe(true);
    expect(() => reopened.begin(input)).toThrow("原导出仍在提交");
    request.complete(key);
    expect(reopened.pending).toBeUndefined();
    const next = reopened.begin(input);
    request.complete(key);
    request.settle(key);
    expect(reopened.pending?.key).toBe(next.key);
    expect(reopened.inFlight).toBe(true);
  });
  it("恢复旧指纹记录保留原键与内容，不要求手工还原筛选", () => {
    storage.set(
      "test",
      JSON.stringify({ key, fingerprint: JSON.stringify(input) }),
    );
    const request = new ReportAttempt("test", scope);
    expect(request.ready).toBe(true);
    expect(request.begin({ ...input, keyword: "新条件" })).toMatchObject({
      key,
      payload: input,
    });
  });
  it("拒绝损坏及其他企业、品牌或类型的暂存，不发送新请求覆盖", () => {
    for (const [index, payload] of [
      { ...input, organizationId: "44444444-4444-4444-8444-444444444444" },
      { ...input, teamBindingId: "44444444-4444-4444-8444-444444444444" },
      { ...input, brandId: "brand-b" },
      { ...input, reportType: "domain_rank" },
      { ...input, beginDate: "bad" },
    ].entries()) {
      const id = `test-${index}`;
      storage.set(id, JSON.stringify({ key, payload }));
      const request = new ReportAttempt(id, scope);
      expect(request.ready).toBe(false);
      expect(() => request.begin(input)).toThrow("无法读取原导出记录");
      expect(storage.get(id)).toContain(JSON.stringify(payload));
    }
  });
  it("暂存失败不创建请求，存储恢复后仍可正常提交", () => {
    const request = new ReportAttempt("test", scope);
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem() {
        throw new Error("denied");
      },
    });
    expect(() => request.begin(input)).toThrow("尚未发送请求");
    expect(request.pending).toBeUndefined();
    expect(request.inFlight).toBe(false);
    vi.stubGlobal("sessionStorage", {
      getItem: (id: string) => storage.get(id) ?? null,
      setItem: (id: string, value: string) => storage.set(id, value),
      removeItem: (id: string) => storage.delete(id),
    });
    expect(request.begin(input, () => key).key).toBe(key);
    expect(request.storageError).toBe("");
  });
  it("读取原记录失败后明确重读可恢复，不丢失已有记录", () => {
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("denied");
      },
    });
    const request = new ReportAttempt("test", scope);
    expect(request.ready).toBe(false);
    vi.stubGlobal("sessionStorage", {
      getItem: () => JSON.stringify({ key, payload: input }),
    });
    request.reload();
    expect(request.ready).toBe(true);
    expect(request.pending).toMatchObject({ key, payload: input });
  });
});
