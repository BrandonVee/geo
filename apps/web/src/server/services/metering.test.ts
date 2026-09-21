import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isPlatformAdministrator: vi.fn(),
  requirePlatformPermission: vi.fn(),
  resolveBrandScope: vi.fn(),
  listBrands: vi.fn(),
  loadAnswerBitTeamContext: vi.fn(),
  queryBillingUsageLogged: vi.fn(),
  queryCreditRankLogged: vi.fn(),
  queryCreditStatusLogged: vi.fn(),
  purchaseQuotaLogged: vi.fn(),
  writeAudit: vi.fn(),
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
vi.mock("@/server/integrations/answerbit/context", () => ({
  loadAnswerBitTeamContext: mocks.loadAnswerBitTeamContext,
}));
vi.mock("@/server/integrations/answerbit/gateway", () => ({
  purchaseQuotaLogged: mocks.purchaseQuotaLogged,
  queryBillingLogsLogged: vi.fn(),
  queryBillingUsageLogged: mocks.queryBillingUsageLogged,
  queryCreditBillsLogged: vi.fn(),
  queryCreditRankLogged: mocks.queryCreditRankLogged,
  queryCreditStatusLogged: mocks.queryCreditStatusLogged,
  queryCreditTrendLogged: vi.fn(),
  queryCreditUsageLogged: vi.fn(),
  queryQuotaOverridesLogged: vi.fn(),
  querySubscriptionLogged: vi.fn(),
}));
vi.mock("@/server/audit/write-audit", () => ({
  writeAudit: mocks.writeAudit,
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  resolveBrandScope: mocks.resolveBrandScope,
}));
vi.mock("@/server/permissions/platform", () => ({
  isPlatformAdministrator: mocks.isPlatformAdministrator,
  requirePlatformPermission: mocks.requirePlatformPermission,
}));
vi.mock("@/server/repositories/brands", () => ({
  brandRepository: { listBrands: mocks.listBrands },
}));
vi.mock("./answerbit-connections", () => ({
  mapUpstreamError: (error: unknown) => {
    throw error;
  },
}));

import { meteringService } from "./metering";

const input = {
  organizationId: "e17c707b-f07c-4464-a4fa-26d699dad45b",
  teamBindingId: "630dacb0-54b4-464c-acd0-de1079ff2a0b",
  brandId: "brand-1",
};
const userId = "d5ddb2bc-44ad-4395-a05b-e3a2ad0129f8";

describe("AnswerBit 计量业务边界", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePlatformPermission.mockResolvedValue(undefined);
    mocks.isPlatformAdministrator.mockResolvedValue(false);
    mocks.resolveBrandScope.mockResolvedValue({
      unrestricted: true,
      accesses: [],
    });
    mocks.listBrands.mockResolvedValue([{ brandId: "brand-1" }]);
    mocks.loadAnswerBitTeamContext.mockResolvedValue({
      team: { teamId: "shared-team" },
      connection: { id: "connection-1" },
      apiKey: "key",
    });
    mocks.queryBillingUsageLogged.mockResolvedValue({
      plan: { valid_from: 1, valid_until: 2, quotas: [] },
      credit: {
        team_id: "shared-team",
        total_amount: 800,
        used_amount: 200,
      },
    });
    mocks.queryCreditStatusLogged.mockResolvedValue({
      team_id: "shared-team",
      total_amount: 800,
      used_amount: 200,
      credit_details: [],
    });
    mocks.purchaseQuotaLogged.mockResolvedValue({});
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("企业用户只获得品牌周期用量，不返回共享 TeamID 积分", async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(false);

    await expect(
      meteringService.usage(input, userId, "request-1"),
    ).resolves.toEqual({
      plan: { valid_from: 1, valid_until: 2, quotas: [] },
    });
  });

  it("平台管理员可读取完整官方账户概况", async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true);

    await expect(
      meteringService.usage(input, userId, "request-1"),
    ).resolves.toMatchObject({
      credit: { total_amount: 800, used_amount: 200 },
    });
    expect(mocks.resolveBrandScope).not.toHaveBeenCalled();
  });

  it("平台管理员不指定品牌时读取团队级容量配额", async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true);

    await meteringService.usage(
      {
        organizationId: input.organizationId,
        teamBindingId: input.teamBindingId,
      },
      userId,
      "request-team-usage",
    );

    expect(mocks.queryBillingUsageLogged).toHaveBeenCalledWith(
      "key",
      { team_id: "shared-team" },
      expect.objectContaining({
        requestId: "request-team-usage",
        brandId: undefined,
      }),
    );
  });

  it("平台管理员指定品牌时仍读取品牌级用量", async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true);

    await meteringService.usage(input, userId, "request-brand-usage");

    expect(mocks.queryBillingUsageLogged).toHaveBeenCalledWith(
      "key",
      { team_id: "shared-team", brand_id: "brand-1" },
      expect.objectContaining({
        requestId: "request-brand-usage",
        brandId: "brand-1",
      }),
    );
  });

  it("共享订阅、积分批次、订阅日志和配额记录要求平台权限", async () => {
    mocks.requirePlatformPermission.mockRejectedValue(
      new Error("PLATFORM_PERMISSION_DENIED"),
    );

    const pageInput = { ...input, page: 1, pageSize: 20 };
    for (const execute of [
      () => meteringService.subscription(input, userId, "request-1"),
      () => meteringService.credits(input, userId, "request-1"),
      () => meteringService.subscriptionLogs(pageInput, userId, "request-1"),
      () => meteringService.quotaOverrides(pageInput, userId, "request-1"),
    ])
      await expect(execute()).rejects.toThrow("PLATFORM_PERMISSION_DENIED");
    expect(mocks.requirePlatformPermission).toHaveBeenCalledTimes(4);
    expect(mocks.loadAnswerBitTeamContext).not.toHaveBeenCalled();
    expect(mocks.queryCreditStatusLogged).not.toHaveBeenCalled();
  });

  it("团队级品牌排行在返回后按企业品牌集合过滤", async () => {
    mocks.queryCreditRankLogged.mockResolvedValue([
      { brand_id: "brand-1", brand_name: "本企业", credit_used: 20 },
      { brand_id: "brand-2", brand_name: "其他企业", credit_used: 10 },
    ]);

    await expect(
      meteringService.creditRanks(
        { ...input, quotaTypes: [] },
        userId,
        "request-1",
      ),
    ).resolves.toEqual([
      { brand_id: "brand-1", brand_name: "本企业", credit_used: 20 },
    ]);
  });

  it("平台管理员通过腾讯官方写接口扩容监控品牌并写审计", async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true);
    const audit = {
      actorUserId: userId,
      requestId: "request-1",
    };

    await expect(
      meteringService.purchaseQuota(
        {
          ...input,
          quotaType: "max_brand",
          quotaAmount: 2,
        },
        userId,
        audit,
      ),
    ).resolves.toEqual({
      quotaType: "max_brand",
      quotaAmount: 2,
      estimatedCreditCost: 800,
    });
    expect(mocks.requirePlatformPermission).toHaveBeenCalledWith(
      userId,
      "platform.tenant.manage",
    );
    expect(mocks.purchaseQuotaLogged).toHaveBeenCalledWith(
      "key",
      {
        team_id: "shared-team",
        quota_type: "max_brand",
        quota_amount: 2,
      },
      expect.objectContaining({ requestId: "request-1" }),
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: input.organizationId }),
      expect.objectContaining({
        operation: "platform.answerbit.quota.purchase",
      }),
    );
  });
});
