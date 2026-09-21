import { hasPermission, type Permission, type Role } from "@geo/core";
import { ApiError } from "@/server/http/errors";
import { assertOrganizationFeatureEnabled } from "@/server/permissions/organization-features";
import { brandRepository } from "@/server/repositories/brands";
import { organizationRepository } from "@/server/repositories/organizations";

export async function resolveBrandScope(
  organizationId: string,
  teamBindingId: string,
  userId: string,
  permission: Permission,
) {
  const membership = await brandRepository.findActiveMembership(
    organizationId,
    userId,
  );
  if (!membership)
    throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
  await assertOrganizationFeatureEnabled(organizationId, userId, permission);
  const organizationRole = await organizationRepository.findMembershipRole(
    organizationId,
    userId,
  );
  if (!organizationRole || organizationRole.status !== "active")
    throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
  if (organizationRole.organizationStatus !== "active")
    throw new ApiError(403, "ORGANIZATION_SUSPENDED", "企业已被冻结或关闭");
  if (!(await brandRepository.findTeam(organizationId, teamBindingId)))
    throw new ApiError(
      404,
      "TEAM_BINDING_NOT_FOUND",
      "企业腾讯范围不存在或已停用",
    );
  if (
    organizationRole?.role &&
    hasPermission(organizationRole.role as Role, permission)
  ) {
    return {
      unrestricted: true as const,
      accesses: [] as Awaited<
        ReturnType<typeof brandRepository.listUserBrandAccess>
      >,
    };
  }
  const accesses = (
    await brandRepository.listUserBrandAccess(
      organizationId,
      teamBindingId,
      userId,
    )
  ).filter((access) => hasPermission(access.role as Role, permission));
  if (!accesses.length)
    throw new ApiError(403, "PERMISSION_DENIED", "没有访问该团队品牌的权限");
  return { unrestricted: false as const, accesses };
}

export async function authorizeBrand(
  organizationId: string,
  teamBindingId: string,
  brandId: string,
  userId: string,
  permission: Permission,
) {
  const scope = await resolveBrandScope(
    organizationId,
    teamBindingId,
    userId,
    permission,
  );
  if (
    !(await brandRepository.findBrand(organizationId, teamBindingId, brandId))
  )
    throw new ApiError(404, "BRAND_NOT_FOUND", "品牌不属于当前企业范围");
  if (
    !scope.unrestricted &&
    !scope.accesses.some((access) => access.brandId === brandId)
  )
    throw new ApiError(403, "PERMISSION_DENIED", "没有访问该品牌的权限");
  return scope;
}
