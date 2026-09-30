import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  member: vi.fn(),
  role: vi.fn(),
  team: vi.fn(),
  brand: vi.fn(),
  access: vi.fn(),
}));
vi.mock("@/server/repositories/brands", () => ({
  brandRepository: {
    findActiveMembership: m.member,
    findTeam: m.team,
    findBrand: m.brand,
    listUserBrandAccess: m.access,
  },
}));
vi.mock("@/server/repositories/organizations", () => ({
  organizationRepository: { findMembershipRole: m.role },
}));
vi.mock("@/server/permissions/organization-features", () => ({
  assertOrganizationFeatureEnabled: vi.fn(),
}));
vi.mock("@/server/http/errors", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));
import { authorizeBrand } from "./brand-scope";
beforeEach(() => {
  vi.clearAllMocks();
  m.member.mockResolvedValue({ id: "member" });
  m.role.mockResolvedValue({
    role: "tenant_admin",
    status: "active",
    organizationStatus: "active",
  });
  m.team.mockResolvedValue({ id: "team" });
  m.brand.mockResolvedValue({ id: "brand" });
  m.access.mockResolvedValue([]);
});
describe("品牌范围授权", () => {
  it("企业管理员也需校验真实品牌归属", async () => {
    m.brand.mockResolvedValue(undefined);
    await expect(
      authorizeBrand("org", "team", "other", "user", "publication.create"),
    ).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
  });
  it("冻结企业禁止本地余额与发布业务", async () => {
    m.role.mockResolvedValue({
      role: "tenant_admin",
      status: "active",
      organizationStatus: "suspended",
    });
    await expect(
      authorizeBrand("org", "team", "brand", "user", "balance.read"),
    ).rejects.toMatchObject({ code: "ORGANIZATION_SUSPENDED" });
  });
  it("停用的内部范围禁止调用", async () => {
    m.team.mockResolvedValue(undefined);
    await expect(
      authorizeBrand("org", "team", "brand", "user", "publication.read"),
    ).rejects.toMatchObject({ code: "TEAM_BINDING_NOT_FOUND" });
  });
  it("有效品牌角色保留原权限", async () => {
    await expect(
      authorizeBrand("org", "team", "brand", "user", "publication.create"),
    ).resolves.toMatchObject({ unrestricted: true });
  });
});

describe("代理与客户的文章范围", () => {
  it("代理商不能访问没有成员关系的企业", async () => {
    m.member.mockResolvedValue(undefined);
    await expect(
      authorizeBrand("other-org", "team", "brand", "agent", "resource.read"),
    ).rejects.toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });
  });
  it("客户只能查看被授权品牌，查看者不可编辑", async () => {
    m.role.mockResolvedValue({
      role: null,
      status: "active",
      organizationStatus: "active",
    });
    m.access.mockResolvedValue([{ brandId: "brand", role: "brand_viewer" }]);
    await expect(
      authorizeBrand("org", "team", "brand", "customer", "resource.read"),
    ).resolves.toMatchObject({ unrestricted: false });
    await expect(
      authorizeBrand("org", "team", "other", "customer", "resource.read"),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      authorizeBrand("org", "team", "brand", "customer", "resource.update"),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
