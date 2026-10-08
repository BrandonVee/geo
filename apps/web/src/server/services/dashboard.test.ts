import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardBaseQuery } from "@geo/contracts";

const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  context: vi.fn(),
  metrics: vi.fn(),
  evaluate: vi.fn(),
  mapError: vi.fn(),
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: m.authorize,
}));
vi.mock("@/server/integrations/answerbit/context", () => ({
  loadAnswerBitTeamContext: m.context,
}));
vi.mock("@/server/integrations/answerbit/gateway", () => ({
  queryDashboardMetricsLogged: m.metrics,
}));
vi.mock("./notifications", () => ({ evaluateMetricAnomaly: m.evaluate }));
vi.mock("./answerbit-connections", () => ({ mapUpstreamError: m.mapError }));
import { dashboardService } from "./dashboard";

const query: DashboardBaseQuery = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  teamBindingId: "22222222-2222-4222-8222-222222222222",
  brandId: "brand",
  beginDate: "2026-03-01",
  endDate: "2026-03-07",
  titleIds: ["title"],
  platforms: ["model"],
  tagIds: ["tag"],
};
const metrics = {
  exposure: { value: 10, fluctuation: -30 },
  score: { value: 20, fluctuation: 0 },
  avg_rank: { value: 3, fluctuation: 0 },
};
beforeEach(() => {
  vi.resetAllMocks();
  m.context.mockResolvedValue({
    apiKey: "qa",
    connection: { id: "connection" },
  });
  m.metrics.mockImplementation(async (_key, _payload, _log, onFreshResult) => {
    await onFreshResult?.(metrics);
    return metrics;
  });
  m.evaluate.mockResolvedValue(undefined);
});

describe("总览指标与通知评估", () => {
  it("缓存结果仍返回页面，但不作为新检测评估通知", async () => {
    m.metrics.mockResolvedValue(metrics);
    expect(await dashboardService.metrics(query, "user", "request")).toBe(
      metrics,
    );
    expect(m.evaluate).not.toHaveBeenCalled();
  });
  it("成功指标携带原查询日期和全部筛选条件评估通知", async () => {
    expect(await dashboardService.metrics(query, "user", "request")).toBe(
      metrics,
    );
    expect(m.evaluate).toHaveBeenCalledWith(
      query.organizationId,
      query.teamBindingId,
      query.brandId,
      metrics,
      query,
    );
    expect(m.authorize).toHaveBeenCalledWith(
      query.organizationId,
      query.teamBindingId,
      query.brandId,
      "user",
      "resource.read",
      "geo_insights",
    );
  });
  it.each([
    ["QA_EVALUATION_FAILED", "QA_EVALUATION_FAILED"],
    [
      "Failed query: select notification_rules ... params: private",
      "NOTIFICATION_EVALUATION_FAILED",
    ],
  ])(
    "通知检测故障不改变指标结果，日志只包含稳定错误码",
    async (message, errorCode) => {
      m.evaluate.mockRejectedValue(new Error(message));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(await dashboardService.metrics(query, "user", "request")).toBe(
          metrics,
        );
        expect(
          log.mock.calls.map(([value]) => JSON.parse(value as string)),
        ).toEqual([
          {
            event: "notification.metric.failed",
            requestId: "request",
            errorCode,
          },
        ]);
        expect(m.mapError).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
    },
  );
  it("上游读取失败时不以缺失指标评估通知", async () => {
    const error = new Error("QA_UPSTREAM_FAILED");
    m.metrics.mockRejectedValue(error);
    m.mapError.mockImplementation(() => {
      throw error;
    });
    await expect(
      dashboardService.metrics(query, "user", "request"),
    ).rejects.toBe(error);
    expect(m.evaluate).not.toHaveBeenCalled();
  });
});
