import type { Permission, Role } from "@geo/core";
import { hasPermission } from "@geo/core";
import { ApiError } from "@/server/http/errors";
import { assertOrganizationFeatureEnabled } from "@/server/permissions/organization-features";
import { organizationRepository } from "@/server/repositories/organizations";
export const organizationService = {
  list(userId: string) {
    return organizationRepository.listForUser(userId);
  },
  async create(userId: string) {
    void userId;
    throw new ApiError(
      410,
      "ORGANIZATION_PLATFORM_MANAGED",
      "企业仅由腾讯品牌目录同步生成",
    );
  },
  async authorize(
    organizationId: string,
    userId: string,
    permission: Permission,
  ) {
    const membership = await organizationRepository.findMembershipRole(
      organizationId,
      userId,
    );
    if (!membership || membership.status !== "active")
      throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    if (membership.organizationStatus !== "active")
      throw new ApiError(
        403,
        "ORGANIZATION_SUSPENDED",
        "企业已被平台冻结或关闭",
      );
    const role = membership.role as Role | null;
    if (!role || !hasPermission(role, permission))
      throw new ApiError(403, "PERMISSION_DENIED", "没有执行此操作的权限");
    await assertOrganizationFeatureEnabled(organizationId, userId, permission);
    return { organizationId, userId, role };
  },
  async get(organizationId: string, userId: string) {
    await this.authorize(organizationId, userId, "tenant.settings.read");
    const organization = await organizationRepository.findById(organizationId);
    if (!organization)
      throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    return organization;
  },
  async update(organizationId: string, userId: string) {
    await this.authorize(organizationId, userId, "tenant.settings.manage");
    throw new ApiError(
      410,
      "ORGANIZATION_NAME_PLATFORM_MANAGED",
      "企业名称由腾讯品牌目录同步维护",
    );
  },
};
