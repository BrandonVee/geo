import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import { resolveBrandScope } from "@/server/permissions/brand-scope";
import { isPlatformAdministrator } from "@/server/permissions/platform";
import { brandRepository } from "@/server/repositories/brands";

export const brandService = {
  async list(
    organizationId: string,
    teamBindingId: string,
    userId: string,
    _requestId: string,
  ) {
    void _requestId; // Kept for the existing service signature; this read is local.
    const scope = (await isPlatformAdministrator(userId))
      ? ({ unrestricted: true as const, accesses: [] } as const)
      : await resolveBrandScope(
          organizationId,
          teamBindingId,
          userId,
          "resource.read",
        );
    await loadAnswerBitTeamContext(organizationId, teamBindingId);
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
