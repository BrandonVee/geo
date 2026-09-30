import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  enterprise: vi.fn(),
  membership: vi.fn(),
  feature: vi.fn(),
  authorize: vi.fn(),
  team: vi.fn(),
  create: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@geo/db", () => ({ assertEnterpriseAccess: m.enterprise }));
vi.mock("@/server/repositories/organizations", () => ({
  organizationRepository: { findMembershipRole: m.membership },
}));
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: m.authorize,
}));
vi.mock("@/server/permissions/organization-features", () => ({
  assertOrganizationFeatureEnabled: m.feature,
}));
vi.mock("@/server/repositories/brands", () => ({
  brandRepository: { findTeamForBrand: m.team },
}));
vi.mock("@/server/repositories/saved-views", () => ({
  savedViewRepository: {
    create: m.create,
    find: m.find,
    update: m.update,
    list: m.list,
    remove: m.remove,
  },
}));
vi.mock("@/server/audit/write-audit", () => ({ writeAudit: m.audit }));
import { savedViewService } from "./saved-views";
const org = "11111111-1111-4111-8111-111111111111",
  team = "22222222-2222-4222-8222-222222222222";
const input = {
  organizationId: org,
  name: "筛选",
  page: "answers" as const,
  isDefault: false,
  filters: { brandId: "brand", beginDate: "2026-09-01", endDate: "2026-09-23" },
};
const audit = {
  organizationId: org,
  actorUserId: "user",
  requestId: "request",
};
beforeEach(() => {
  vi.resetAllMocks();
  m.membership.mockResolvedValue({
    status: "active",
    organizationStatus: "active",
    role: null,
  });
  m.team.mockResolvedValue({ id: team });
  m.create.mockResolvedValue({ id: "view", ...input });
  m.find.mockResolvedValue({ id: "view", ...input });
  m.update.mockResolvedValue(input);
});
describe("个人保存视图", () => {
  it("旧客户端只给品牌也会解析内部绑定并验证品牌授权", async () => {
    await savedViewService.create(input, "user", audit);
    expect(m.authorize).toHaveBeenCalledWith(
      org,
      team,
      "brand",
      "user",
      "resource.read",
      "geo_insights",
    );
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ teamBindingId: team }),
      }),
      "user",
    );
  });
  it("企业内不存在的品牌不能跳过归属校验", async () => {
    m.team.mockResolvedValue(undefined);
    await expect(
      savedViewService.create(input, "user", audit),
    ).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("品牌存在但当前用户无权限时不会写入视图", async () => {
    m.authorize.mockRejectedValue({ code: "PERMISSION_DENIED" });
    await expect(
      savedViewService.create(input, "user", audit),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("回答视图按 GEO 功能范围验证，不依赖内容模块", async () => {
    await savedViewService.list(org, "answers", "user");
    expect(m.feature).toHaveBeenCalledWith(
      org,
      "user",
      "resource.read",
      "geo_insights",
    );
  });
  it("拒绝损坏日期或提及筛选，防止恢复视图使页面无法查询", async () => {
    await expect(
      savedViewService.create(
        { ...input, filters: { ...input.filters, beginDate: "invalid" } },
        "user",
        audit,
      ),
    ).rejects.toMatchObject({ code: "SAVED_VIEW_FILTERS_INVALID" });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("改名不更换原筛选，更新筛选则再次校验品牌", async () => {
    await savedViewService.update(
      "view",
      { organizationId: org, name: "新名称" },
      "user",
      audit,
    );
    expect(m.update).toHaveBeenCalledWith("view", org, "user", {
      name: "新名称",
    });
    await savedViewService.update(
      "view",
      { organizationId: org, filters: input.filters },
      "user",
      audit,
    );
    expect(m.authorize).toHaveBeenCalledWith(
      org,
      team,
      "brand",
      "user",
      "resource.read",
      "geo_insights",
    );
  });
});
