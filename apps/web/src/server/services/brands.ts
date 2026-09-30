import { ApiError } from "@/server/http/errors";
import { isPlatformAdministrator } from "@/server/permissions/platform";
import { brandRepository } from "@/server/repositories/brands";
import { organizationRepository } from "@/server/repositories/organizations";

export const brandService = {
  async list(
    organizationId: string,
    teamBindingId: string,
    userId: string,
    _requestId: string,
  ) {
    void _requestId; // Kept for the existing service signature; this read is local.
    // @project-doc docs/domains/identity_and_access.md#workspace_directory
    const platformAdmin = await isPlatformAdministrator(userId);
    const organization = await organizationRepository.findById(organizationId);
    if (!organization || organization.status === "closed")
      throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    if (!(await brandRepository.findTeam(organizationId, teamBindingId)))
      throw new ApiError(
        404,
        "TEAM_BINDING_NOT_FOUND",
        "企业品牌范围不存在或已停用",
      );
    const membership = platformAdmin
      ? undefined
      : await organizationRepository.findMembershipRole(organizationId, userId);
    if (!platformAdmin && (!membership || membership.status !== "active"))
      throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
    const unrestricted = platformAdmin || membership?.role === "tenant_admin";
    const accesses = unrestricted
      ? []
      : await brandRepository.listUserBrandAccess(
          organizationId,
          teamBindingId,
          userId,
        );
    const scope = { unrestricted, accesses };
    const mappings = await brandRepository.listBrands(
      organizationId,
      teamBindingId,
    );
    const brands = mappings.map((mapping) => ({
      id: mapping.brandId,
      name: mapping.brandName,
    }));
    const visibleBrandIds = new Set(
      scope.unrestricted
        ? mappings.map((mapping) => mapping.brandId)
        : scope.accesses.map((access) => access.brandId),
    );
    const visibleBrands = brands.filter((brand) =>
      visibleBrandIds.has(brand.id),
    );
    return scope.unrestricted
      ? visibleBrands.map((brand) => ({
          ...brand,
          accessRole: "tenant_admin" as const,
        }))
      : visibleBrands.flatMap((brand) => {
          const access = scope.accesses.find(
            (item) => item.brandId === brand.id,
          );
          return access ? [{ ...brand, accessRole: access.role }] : [];
        });
  },
};
