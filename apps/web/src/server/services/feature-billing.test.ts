import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consumeBalance: vi.fn(),
  getEffectiveFeaturePointCost: vi.fn(),
  restoreBalance: vi.fn(),
}));

vi.mock("@geo/db", () => ({
  consumeBalance: mocks.consumeBalance,
  getEffectiveFeaturePointCost: mocks.getEffectiveFeaturePointCost,
  restoreBalance: mocks.restoreBalance,
}));
vi.mock("@/server/http/errors", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import {
  getPointBilledFeatureQuote,
  runPointBilledFeature,
} from "./feature-billing";

const input = {
  featureCode: "effect_tracking" as const,
  featureName: "效果追踪链接",
  organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
  brandId: "brand-1",
  actorUserId: "d5ddb2bc-44ad-4395-a05b-e3a2ad0129f8",
  referenceId: "request-1",
};

describe("业务功能积分计费", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveFeaturePointCost.mockResolvedValue({
      tier: "silver",
      basePoints: 25,
      pointMultiplierBps: 8000,
      points: 20,
    });
    mocks.consumeBalance.mockResolvedValue({
      ok: true,
      replayed: false,
      transaction: { amount: 20 },
    });
  });

  it("向用户展示按客户等级计算后的预计积分", async () => {
    await expect(
      getPointBilledFeatureQuote("ai_article_generation", input.actorUserId),
    ).resolves.toEqual({
      tier: "silver",
      basePoints: 25,
      pointMultiplierBps: 8000,
      points: 20,
    });
    expect(mocks.getEffectiveFeaturePointCost).toHaveBeenCalledWith(
      "ai_article_generation",
      input.actorUserId,
    );
  });

  it("完整功能只扣一次，不关心内部调用多少接口", async () => {
    const upstreamCall = vi.fn().mockResolvedValue("ok");

    await expect(runPointBilledFeature(input, upstreamCall)).resolves.toBe(
      "ok",
    );

    expect(upstreamCall).toHaveBeenCalledTimes(1);
    expect(mocks.consumeBalance).toHaveBeenCalledTimes(1);
    expect(mocks.consumeBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 20,
        referenceType: "feature_usage",
        idempotencyKey: "feature:effect_tracking:request-1:consume",
      }),
    );
    expect(mocks.restoreBalance).not.toHaveBeenCalled();
  });

  it("功能失败按原扣减金额返还", async () => {
    const error = new Error("feature failed");

    await expect(
      runPointBilledFeature(input, async () => {
        throw error;
      }),
    ).rejects.toBe(error);

    expect(mocks.restoreBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 20,
        referenceType: "feature_usage_failed",
        idempotencyKey: "feature:effect_tracking:request-1:restore",
      }),
    );
  });

  it("零积分功能直接执行", async () => {
    mocks.getEffectiveFeaturePointCost.mockResolvedValue({
      tier: "gold",
      basePoints: 0,
      pointMultiplierBps: 7000,
      points: 0,
    });

    await expect(
      runPointBilledFeature(input, async () => "free"),
    ).resolves.toBe("free");

    expect(mocks.consumeBalance).not.toHaveBeenCalled();
  });

  it("余额不足时不执行功能", async () => {
    mocks.consumeBalance.mockResolvedValue({
      ok: false,
      code: "INSUFFICIENT_BALANCE",
    });
    const execute = vi.fn();

    await expect(runPointBilledFeature(input, execute)).rejects.toMatchObject({
      status: 402,
      code: "ANSWERBIT_POINTS_INSUFFICIENT",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
