import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePlatformPermission: vi.fn(),
  authorizeBrand: vi.fn(),
  authorizeOrganization: vi.fn(),
  membershipRole: vi.fn(),
  list: vi.fn(),
  pointUsage: vi.fn(),
  transactions: vi.fn(),
  transactionActors: vi.fn(),
  deduct: vi.fn(),
  confirmation: vi.fn(),
  organizationBalances: vi.fn(),
  allocate: vi.fn(),
  allocationConfirmation: vi.fn(),
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
    list: mocks.list,
    pointUsage: mocks.pointUsage,
    transactions: mocks.transactions,
    transactionActors: mocks.transactionActors,
    deduct: mocks.deduct,
    confirmation: mocks.confirmation,
    organizationBalances: mocks.organizationBalances,
    allocate: mocks.allocate,
    allocationConfirmation: mocks.allocationConfirmation,
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

describe("企业品牌划拨授权与结果核对", () => {
  const input = {
    organizationId: "org",
    brandId: "brand",
    asset: "answerbit_points" as const,
    amount: 10,
    reason: "企业向品牌划拨",
    idempotencyKey: "allocation-key",
  };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.brandExists.mockResolvedValue(true);
  });
  it("没有划拨权限时不写入也不读取核对结果", async () => {
    mocks.authorizeOrganization.mockRejectedValue(new Error("forbidden"));
    await expect(balanceService.allocate(input, userId, audit)).rejects.toThrow(
      "forbidden",
    );
    await expect(
      balanceService.allocationConfirmation(input, userId),
    ).rejects.toThrow("forbidden");
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(mocks.allocationConfirmation).not.toHaveBeenCalled();
    expect(mocks.authorizeOrganization).toHaveBeenCalledWith(
      "org",
      userId,
      "balance.allocate",
    );
  });
  it("跨企业品牌不能写入或核对", async () => {
    mocks.brandExists.mockResolvedValue(false);
    await expect(
      balanceService.allocate(input, userId, audit),
    ).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
    await expect(
      balanceService.allocationConfirmation(input, userId),
    ).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
    expect(mocks.allocate).not.toHaveBeenCalled();
    expect(mocks.allocationConfirmation).not.toHaveBeenCalled();
  });
  it("同键内容冲突与额度、余额不足分别返回明确错误", async () => {
    for (const [code, status] of [
      ["IDEMPOTENCY_CONFLICT", 409],
      ["AGENT_ANSWERBIT_POINTS_QUOTA_EXCEEDED", 422],
      ["INSUFFICIENT_BALANCE", 422],
    ] as const) {
      mocks.allocate.mockResolvedValue({ ok: false, code });
      await expect(
        balanceService.allocate(input, userId, audit),
      ).rejects.toMatchObject({ status, code });
    }
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
  it("成功重放不额外写审计，核对绑定当前操作者", async () => {
    mocks.allocate.mockResolvedValue({
      ok: true,
      replayed: true,
      transaction: { id: "ledger" },
    });
    await expect(
      balanceService.allocate(input, userId, audit),
    ).resolves.toMatchObject({ replayed: true });
    await balanceService.allocationConfirmation(input, userId);
    expect(mocks.allocationConfirmation).toHaveBeenCalledWith(input, userId);
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});

describe("企业完整资产流水权限", () => {
  const input = {
    organizationId: "enterprise",
    page: 6,
    pageSize: 20,
    beginDate: "2026-01-01",
    endDate: "2026-01-31",
  };
  beforeEach(() => vi.clearAllMocks());
  it("企业管理员分页读取，日期转为北京时间闭合范围", async () => {
    mocks.authorizeOrganization.mockResolvedValue({ role: "tenant_admin" });
    await balanceService.transactions(input, userId);
    expect(mocks.transactions).toHaveBeenCalledWith(
      {
        organizationId: input.organizationId,
        page: 6,
        pageSize: 20,
        beginAt: new Date("2025-12-31T16:00:00Z"),
        endAtExclusive: new Date("2026-01-31T16:00:00Z"),
      },
      userId,
    );
    await balanceService.transactionActors(
      { organizationId: input.organizationId, q: "历史" },
      userId,
    );
    expect(mocks.transactionActors).toHaveBeenCalledWith(
      { organizationId: input.organizationId, q: "历史" },
      userId,
    );
  });
  it.each(["brand_admin", "brand_editor", "brand_viewer"])(
    "%s 不能读取企业流水或历史操作者",
    async (role) => {
      mocks.authorizeOrganization.mockResolvedValue({ role });
      await expect(
        balanceService.transactions(input, userId),
      ).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
      await expect(
        balanceService.transactionActors(
          { organizationId: input.organizationId },
          userId,
        ),
      ).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
      await expect(
        balanceService.list(input.organizationId, undefined, undefined, userId),
      ).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.transactions).not.toHaveBeenCalled();
      expect(mocks.transactionActors).not.toHaveBeenCalled();
    },
  );
  it("企业授权失败时不读取任何流水或用户资料", async () => {
    mocks.authorizeOrganization
      .mockRejectedValueOnce(new Error("scope denied"))
      .mockRejectedValueOnce(new Error("scope denied"));
    await expect(balanceService.transactions(input, userId)).rejects.toThrow(
      "scope denied",
    );
    await expect(
      balanceService.transactionActors(
        { organizationId: input.organizationId },
        userId,
      ),
    ).rejects.toThrow("scope denied");
    expect(mocks.transactions).not.toHaveBeenCalled();
    expect(mocks.transactionActors).not.toHaveBeenCalled();
  });
});
