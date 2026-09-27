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

import { consumeFeaturePoints, restoreFeaturePoints } from "./feature-billing";

const context = {
  organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
  brandId: "brand-1",
  actorUserId: "d5ddb2bc-44ad-4395-a05b-e3a2ad0129f8",
  referenceId: "job-1",
};

describe("异步文章积分计费", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveFeaturePointCost.mockResolvedValue({
      tier: "retail",
      basePoints: 10,
      pointMarkupBps: 3000,
      points: 13,
    });
    mocks.consumeBalance.mockResolvedValue({
      ok: true,
      replayed: false,
      transaction: { amount: 13 },
    });
  });

  it("按操作用户等级的实际积分扣费并按原金额返还", async () => {
    const charged = await consumeFeaturePoints(
      "ai_article_generation",
      "AI 文章生成",
      context,
    );
    expect(mocks.getEffectiveFeaturePointCost).toHaveBeenCalledWith(
      "ai_article_generation",
      context.actorUserId,
    );
    expect(mocks.consumeBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 13,
        idempotencyKey: "feature:ai_article_generation:job-1:consume",
      }),
    );
    expect(charged).toBe(13);

    await restoreFeaturePoints(
      "ai_article_generation",
      "AI 文章生成",
      charged,
      context,
    );
    expect(mocks.restoreBalance).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 13,
        idempotencyKey: "feature:ai_article_generation:job-1:restore",
      }),
    );
  });

  it("零基础积分不扣费", async () => {
    mocks.getEffectiveFeaturePointCost.mockResolvedValue({
      tier: "retail",
      basePoints: 0,
      pointMarkupBps: 3000,
      points: 0,
    });
    await expect(
      consumeFeaturePoints("ai_article_generation", "AI 文章生成", context),
    ).resolves.toBe(0);
    expect(mocks.consumeBalance).not.toHaveBeenCalled();
  });

  it("异步执行时使用提交时锁定的价格", async () => {
    mocks.consumeBalance.mockResolvedValue({
      ok: true,
      replayed: false,
      transaction: { amount: 12 },
    });
    const charged = await consumeFeaturePoints(
      "ai_article_generation",
      "AI 文章生成",
      {
        ...context,
        pricingSnapshot: { tier: "silver", points: 12 },
      },
    );
    expect(mocks.getEffectiveFeaturePointCost).not.toHaveBeenCalled();
    expect(mocks.consumeBalance).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 12 }),
    );
    expect(charged).toBe(12);
  });
});
