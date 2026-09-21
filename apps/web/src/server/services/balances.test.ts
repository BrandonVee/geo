import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePlatformPermission: vi.fn(),
  authorizeBrand: vi.fn(),
  authorizeOrganization: vi.fn(),
  pointUsage: vi.fn(),
  setPointCost: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/server/permissions/platform", () => ({
  requirePlatformPermission: mocks.requirePlatformPermission,
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
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: mocks.authorizeBrand,
}));
vi.mock("@/server/audit/write-audit", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("@/server/repositories/balances", () => ({
  balanceRepository: {
    pointUsage: mocks.pointUsage,
    setPointCost: mocks.setPointCost,
  },
}));
vi.mock("./organizations", () => ({
  organizationService: { authorize: mocks.authorizeOrganization },
}));

import { balanceService } from "./balances";

const userId = "d5ddb2bc-44ad-4395-a05b-e3a2ad0129f8";
const audit = {
  requestId: "request-1",
  actorUserId: userId,
};

describe("平台功能积分规则", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setPointCost.mockImplementation(async (input) => input);
  });

  it("拒绝把 OpenAPI operation 配置成计费项", async () => {
    await expect(
      balanceService.setPointCost(
        {
          featureCode: "/geo/article/create",
          points: 1,
          description: "接口调用",
        },
        userId,
        audit,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "FEATURE_NOT_BILLABLE",
    });
    expect(mocks.setPointCost).not.toHaveBeenCalled();
  });

  it("拒绝功能目录外的计费编码", async () => {
    await expect(
      balanceService.setPointCost(
        {
          featureCode: "unknown_feature",
          points: 2,
          description: "无效规则",
        },
        userId,
        audit,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "FEATURE_NOT_BILLABLE",
    });
  });

  it("允许更新业务功能积分并写审计", async () => {
    await balanceService.setPointCost(
      {
        featureCode: "ai_article_generation",
        points: 10,
        description: "文章生成",
      },
      userId,
      audit,
    );

    expect(mocks.setPointCost).toHaveBeenCalledWith(
      expect.objectContaining({
        featureCode: "ai_article_generation",
        points: 10,
        updatedBy: userId,
      }),
    );
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
  });
});

describe("租户品牌积分用量", () => {
  const input = {
    organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
    teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
    brandId: "brand-1",
    beginDate: "2026-08-22",
    endDate: "2026-09-20",
    page: 1,
    pageSize: 20,
  };
  const repositoryResult = {
    balance: 680,
    organizationBalance: 320,
    summary: { consumed: 40, restored: 10, transactionCount: 5 },
    list: [],
    pagination: { page: 1, pageSize: 20, total: 5, pages: 1 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeOrganization.mockResolvedValue({ role: "tenant_admin" });
    mocks.pointUsage.mockResolvedValue(repositoryResult);
  });

  it("按已授权品牌读取本地积分账本", async () => {
    const result = await balanceService.pointUsage(input, userId);

    expect(mocks.authorizeBrand).toHaveBeenCalledWith(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "balance.read",
    );
    expect(mocks.pointUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: input.organizationId,
        brandId: input.brandId,
        beginAt: new Date("2026-08-21T16:00:00.000Z"),
        endAtExclusive: new Date("2026-09-20T16:00:00.000Z"),
        page: 1,
        pageSize: 20,
      }),
    );
    expect(result.organizationBalance).toBe(320);
  });

  it("品牌角色不返回企业可分配积分", async () => {
    mocks.authorizeOrganization.mockResolvedValue({ role: "brand_viewer" });

    const result = await balanceService.pointUsage(input, userId);

    expect(result.organizationBalance).toBeNull();
    expect(result.balance).toBe(680);
  });
});
