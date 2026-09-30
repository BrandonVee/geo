import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  platform: vi.fn(),
  organization: vi.fn(),
  team: vi.fn(),
  membership: vi.fn(),
  brands: vi.fn(),
  access: vi.fn(),
}));
vi.mock("@/server/permissions/platform", () => ({
  isPlatformAdministrator: m.platform,
}));
vi.mock("@/server/repositories/organizations", () => ({
  organizationRepository: {
    findById: m.organization,
    findMembershipRole: m.membership,
  },
}));
vi.mock("@/server/repositories/brands", () => ({
  brandRepository: {
    findTeam: m.team,
    listBrands: m.brands,
    listUserBrandAccess: m.access,
  },
}));
import { brandService } from "./brands";
beforeEach(() => {
  vi.resetAllMocks();
  m.organization.mockResolvedValue({
    status: "active",
    serviceExpiresAt: new Date(0),
  });
  m.membership.mockResolvedValue({ role: null, status: "active" });
  m.team.mockResolvedValue({ id: "team" });
  m.brands.mockResolvedValue([
    { brandId: "brand", brandName: "品牌" },
    { brandId: "other", brandName: "其他品牌" },
  ]);
  m.access.mockResolvedValue([{ brandId: "brand", role: "brand_viewer" }]);
});
describe("品牌工作区目录", () => {
  it("仅有品牌角色且服务到期的成员仍能识别自己的品牌", async () => {
    expect(await brandService.list("org", "team", "user", "request")).toEqual([
      { id: "brand", name: "品牌", accessRole: "brand_viewer" },
    ]);
  });
  it("未加入、已停用、关闭或绑定异常的企业不可读取", async () => {
    m.membership.mockResolvedValue({ status: "disabled" });
    await expect(
      brandService.list("org", "team", "user", "request"),
    ).rejects.toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });
    m.membership.mockResolvedValue({ role: "tenant_admin", status: "active" });
    m.team.mockResolvedValue(undefined);
    await expect(
      brandService.list("org", "team", "user", "request"),
    ).rejects.toMatchObject({ code: "TEAM_BINDING_NOT_FOUND" });
    m.organization.mockResolvedValue({ status: "closed" });
    await expect(
      brandService.list("org", "team", "user", "request"),
    ).rejects.toMatchObject({ code: "ORGANIZATION_NOT_FOUND" });
  });
  it("企业管理员可识别本企业的完整品牌目录", async () => {
    m.membership.mockResolvedValue({ role: "tenant_admin", status: "active" });
    expect(
      await brandService.list("org", "team", "user", "request"),
    ).toHaveLength(2);
  });
});
