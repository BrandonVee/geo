import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  queryDashboardMetrics: vi.fn(),
}));

vi.mock("@geo/db", () => ({
  answerbitApiCalls: {},
  db: { insert: vi.fn(() => ({ values: mocks.insertValues })) },
}));

vi.mock("./modules/dashboard", () => ({
  queryDashboardMetrics: mocks.queryDashboardMetrics,
  queryExposureRank: vi.fn(),
  queryExposureTrends: vi.fn(),
  queryFilterPlatforms: vi.fn(),
  queryScoreRank: vi.fn(),
  queryScoreTrends: vi.fn(),
}));

vi.mock("./credential-resolver", () => ({
  resolveAnswerBitCredential: vi.fn(),
}));

vi.mock("./read-cache", () => ({
  cachedAnswerBitRead: ({ execute }: { execute: () => Promise<unknown> }) =>
    execute(),
}));

import {
  queryCreditStatusLogged,
  queryDashboardMetricsLogged,
} from "./gateway";

const context = {
  organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
  connectionId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
  requestId: "request-1",
  actorUserId: "d5ddb2bc-44ad-4395-a05b-e3a2ad0129f8",
  brandId: "brand-1",
};
const payload = {
  brand_id: "brand-1",
  begin_date: "2026-09-01",
  end_date: "2026-09-14",
};

describe("AnswerBit 接口调用日志", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.insertValues.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleError.mockRestore();
  });

  it("官方计量查询只记录调用", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              team_id: "team-1",
              total_amount: 800,
              used_amount: 200,
              credit_details: [],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      queryCreditStatusLogged("API_KEY", "team-1", context),
    ).resolves.toMatchObject({ total_amount: 800, used_amount: 200 });

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "/geo/billing/credit/status",
        status: "success",
      }),
    );
  });

  it("业务接口也只记录调用用户，不在接口层扣积分", async () => {
    mocks.queryDashboardMetrics.mockResolvedValue({
      mention_rate: { value: 1, fluctuation: 0 },
      avg_rank: { value: 1, fluctuation: 0 },
      score: { value: 1, fluctuation: 0 },
    });

    await queryDashboardMetricsLogged("API_KEY", payload, context);

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: context.actorUserId }),
    );
  });

  it("失败接口记录原调用用户", async () => {
    mocks.queryDashboardMetrics.mockRejectedValue(new Error("upstream"));

    await expect(
      queryDashboardMetricsLogged("API_KEY", payload, context),
    ).rejects.toThrow("upstream");

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: context.actorUserId,
        status: "failed",
      }),
    );
  });

  it("成功调用的日志写入失败时不改变业务结果", async () => {
    const result = {
      mention_rate: { value: 1, fluctuation: 0 },
      avg_rank: { value: 1, fluctuation: 0 },
      score: { value: 1, fluctuation: 0 },
    };
    mocks.queryDashboardMetrics.mockResolvedValue(result);
    mocks.insertValues.mockRejectedValueOnce(new Error("log unavailable"));

    await expect(
      queryDashboardMetricsLogged("API_KEY", payload, context),
    ).resolves.toEqual(result);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("answerbit-api-call.log-failed"),
    );
  });

  it("失败调用的日志写入失败时保留原始错误", async () => {
    const upstreamError = new Error("upstream");
    mocks.queryDashboardMetrics.mockRejectedValue(upstreamError);
    mocks.insertValues.mockRejectedValueOnce(new Error("log unavailable"));

    await expect(
      queryDashboardMetricsLogged("API_KEY", payload, context),
    ).rejects.toBe(upstreamError);

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("answerbit-api-call.log-failed"),
    );
  });
});
