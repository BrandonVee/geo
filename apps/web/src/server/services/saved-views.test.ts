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
  m.create.mockResolvedValue({
    kind: "created",
    row: { id: "view", ...input },
  });
  m.list.mockResolvedValue([]);
  m.find.mockResolvedValue({ id: "view", ...input });
  m.update.mockResolvedValue({
    kind: "updated",
    row: { id: "view", ...input },
  });
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
      undefined,
      expect.any(Function),
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
    expect(m.update).toHaveBeenCalledWith(
      "view",
      org,
      "user",
      { name: "新名称" },
      expect.any(Function),
    );
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
  it("重放返回当前视图并隐藏内部创建记录", async () => {
    m.create.mockResolvedValue({
      kind: "replayed",
      row: {
        id: "view",
        ...input,
        name: "已经改名",
        creationKey: "key",
        creationFingerprint: "hash",
        deletedAt: null,
      },
    });
    const result = await savedViewService.create(input, "user", audit, "key");
    expect(result).toMatchObject({ name: "已经改名", replayed: true });
    expect(result).not.toHaveProperty("creationKey");
    expect(result).not.toHaveProperty("creationFingerprint");
    expect(result).not.toHaveProperty("deletedAt");
    expect(m.audit).not.toHaveBeenCalled();
  });
  it.each([
    ["conflict", "SAVED_VIEW_IDEMPOTENCY_CONFLICT"],
    ["removed", "SAVED_VIEW_REMOVED"],
  ])("创建 %s 返回可恢复错误", async (kind, code) => {
    m.create.mockResolvedValue({ kind });
    await expect(
      savedViewService.create(input, "user", audit, "key"),
    ).rejects.toMatchObject({ status: 409, code });
  });
  it("配置冲突返回安全的最新配置", async () => {
    m.update.mockResolvedValue({
      kind: "conflict",
      row: {
        id: "view",
        ...input,
        creationKey: "secret",
        creationFingerprint: "secret",
        deletedAt: null,
      },
    });
    await expect(
      savedViewService.update(
        "view",
        { organizationId: org, name: "新名称" },
        "user",
        audit,
      ),
    ).rejects.toMatchObject({
      code: "SAVED_VIEW_VERSION_CONFLICT",
      details: { current: { id: "view", ...input } },
    });
  });
  it("重复删除成功，不单独补写审计", async () => {
    m.remove.mockResolvedValue(undefined);
    await expect(
      savedViewService.remove("view", org, "user", audit),
    ).resolves.toBeUndefined();
    expect(m.audit).not.toHaveBeenCalled();
  });
});
