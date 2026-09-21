import { loadAnswerBitTeamContext } from "@/server/integrations/answerbit/context";
import { queryBrandsLogged } from "@/server/integrations/answerbit/gateway";
import { resolveBrandScope } from "@/server/permissions/brand-scope";
import { isPlatformAdministrator } from "@/server/permissions/platform";
import { brandRepository } from "@/server/repositories/brands";
import { mapUpstreamError } from "./answerbit-connections";

export const brandService = {
  async list(
    organizationId: string,
    teamBindingId: string,
    userId: string,
    requestId: string,
  ) {
    const scope = (await isPlatformAdministrator(userId))
      ? ({ unrestricted: true as const, accesses: [] } as const)
      : await resolveBrandScope(
          organizationId,
          teamBindingId,
          userId,
          "resource.read",
        );
    const { team, connection, apiKey } = await loadAnswerBitTeamContext(
      organizationId,
      teamBindingId,
    );
    try {
      const brands = await queryBrandsLogged(apiKey, team.teamId, {
        organizationId,
        connectionId: connection.id,
        requestId,
        actorUserId: userId,
      });
      const mappings = await brandRepository.listBrands(
        organizationId,
        teamBindingId,
      );
      const visibleBrandIds = new Set(
        scope.unrestricted
          ? mappings.map((mapping) => mapping.brandId)
          : scope.accesses.map((access) => access.brandId),
      );
      const visibleBrands = brands.filter((brand) =>
        visibleBrandIds.has(brand.id),
      );
      await brandRepository.syncBrandNames(
        organizationId,
        teamBindingId,
        visibleBrands,
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
    } catch (error) {
      return mapUpstreamError(error);
    }
  },
};
