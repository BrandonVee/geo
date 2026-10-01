import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePlatformPermission: vi.fn(),
  authorizeBrand: vi.fn(),
  authorizeOrganization: vi.fn(),
  membershipRole: vi.fn(),
  pointUsage: vi.fn(),
  deduct: vi.fn(),
  confirmation: vi.fn(),
  organizationBalances: vi.fn(),
  brandExists: vi.fn(),
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
    deduct: mocks.deduct,
    confirmation: mocks.confirmation,
    organizationBalances: mocks.organizationBalances,
    brandExists: mocks.brandExists,
    setPointCost: mocks.setPointCost,
  },
}));
vi.mock("./organizations", () => ({
  organizationService: { authorize: mocks.authorizeOrganization },
}));
vi.mock("@/server/repositories/organizations", () => ({
  organizationRepository: { findMembershipRole: mocks.membershipRole },
}));

import { balanceService } from "./balances";

describe("管理员资产调整结果核对", () => {
  it("只有企业读取权限也不能读取企业资产目录", async () => {
    mocks.requirePlatformPermission.mockRejectedValueOnce(
      new Error("forbidden"),
    );
    await expect(
      balanceService.organizationBalances({ page: 1, pageSize: 20 }, "actor"),
    ).rejects.toThrow("forbidden");
    expect(mocks.organizationBalances).not.toHaveBeenCalled();
    expect(mocks.requirePlatformPermission).toHaveBeenLastCalledWith(
      "actor",
      "platform.balance.manage",
    );
  });
  it("没有余额管理权限时不读取原流水", async () => {
    mocks.requirePlatformPermission.mockRejectedValueOnce(
      new Error("forbidden"),
    );
    await expect(
      balanceService.confirmation(
        { organizationId: "org", idempotencyKey: "original-key" },
        "actor",
      ),
    ).rejects.toThrow("forbidden");
    expect(mocks.confirmation).not.toHaveBeenCalled();
  });
});

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
    mocks.membershipRole.mockResolvedValue({ role: "tenant_admin" });
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

  it("企业整体统计先校验企业权限，再读取全部品牌", async () => {
    const enterprise = {
      organizationId: input.organizationId,
      beginDate: input.beginDate,
      endDate: input.endDate,
      page: input.page,
      pageSize: input.pageSize,
    };
    await expect(
      balanceService.pointUsage(enterprise, userId),
    ).resolves.toMatchObject({ organizationBalance: 320 });
    expect(mocks.authorizeOrganization).toHaveBeenCalledWith(
      input.organizationId,
      userId,
      "balance.read",
    );
    expect(mocks.authorizeBrand).not.toHaveBeenCalled();
    expect(mocks.pointUsage).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: undefined }),
    );
  });

  it("品牌角色不能省略范围读取整个企业", async () => {
    mocks.authorizeOrganization.mockRejectedValue(new Error("forbidden"));
    const enterprise = {
      organizationId: input.organizationId,
      beginDate: input.beginDate,
      endDate: input.endDate,
      page: input.page,
      pageSize: input.pageSize,
    };
    await expect(balanceService.pointUsage(enterprise, userId)).rejects.toThrow(
      "forbidden",
    );
    expect(mocks.pointUsage).not.toHaveBeenCalled();
  });

  it("历史企业级品牌角色也不能读取企业整体", async () => {
    mocks.authorizeOrganization.mockResolvedValue(undefined);
    mocks.membershipRole.mockResolvedValue({ role: "brand_admin" });
    const enterprise = {
      organizationId: input.organizationId,
      beginDate: input.beginDate,
      endDate: input.endDate,
      page: input.page,
      pageSize: input.pageSize,
    };
    await expect(
      balanceService.pointUsage(enterprise, userId),
    ).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
    expect(mocks.pointUsage).not.toHaveBeenCalled();
  });

  it("跨品牌请求被拒绝时不读取任何账本", async () => {
    mocks.authorizeBrand.mockRejectedValueOnce(new Error("forbidden"));
    await expect(balanceService.pointUsage(input, userId)).rejects.toThrow(
      "forbidden",
    );
    expect(mocks.pointUsage).not.toHaveBeenCalled();
  });

  it("品牌角色不返回企业可分配积分", async () => {
    mocks.membershipRole.mockResolvedValue({ role: null });
    mocks.authorizeOrganization.mockRejectedValue(
      new Error("No enterprise role"),
    );

    const result = await balanceService.pointUsage(input, userId);

    expect(result.organizationBalance).toBeNull();
    expect(result.balance).toBe(680);
    expect(mocks.authorizeOrganization).not.toHaveBeenCalled();
  });
});

describe("管理员手动扣减", () => {
  const input = {
    organizationId: "org",
    brandId: "brand",
    asset: "answerbit_points" as const,
    amount: 10,
    reason: "人工纠错扣减",
    idempotencyKey: "request-key",
  };
  beforeEach(() => {
    vi.resetAllMocks();
  });
  it("缺少平台权限不能扣减", async () => {
    mocks.requirePlatformPermission.mockRejectedValue(new Error("forbidden"));
    await expect(balanceService.deduct(input, userId, audit)).rejects.toThrow(
      "forbidden",
    );
    expect(mocks.deduct).not.toHaveBeenCalled();
  });
  it("拒绝跨企业品牌；余额不足不写成功审计", async () => {
    mocks.brandExists.mockResolvedValue(false);
    await expect(
      balanceService.deduct(input, userId, audit),
    ).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
    expect(mocks.deduct).not.toHaveBeenCalled();
    mocks.brandExists.mockResolvedValue(true);
    mocks.deduct.mockResolvedValue({ ok: false, code: "INSUFFICIENT_BALANCE" });
    await expect(
      balanceService.deduct(input, userId, audit),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
  it("幂等重放不重复写成功审计", async () => {
    mocks.brandExists.mockResolvedValue(true);
    mocks.deduct.mockResolvedValue({
      ok: true,
      replayed: true,
      transaction: { id: "ledger" },
    });
    await expect(
      balanceService.deduct(input, userId, audit),
    ).resolves.toMatchObject({ replayed: true });
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});
