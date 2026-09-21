import { ApiError } from "@/server/http/errors";
import { billingRepository } from "@/server/repositories/billing";

const namesForErrors = {
  members: "企业成员",
  brands: "品牌",
} as const;
export async function assertEntitlementCapacity(
  organizationId: string,
  entitlementKey: keyof typeof namesForErrors,
) {
  const [entitlement, current] = await Promise.all([
    billingRepository.entitlement(organizationId, entitlementKey),
    billingRepository.resourceCount(organizationId, entitlementKey),
  ]);
  if (!entitlement)
    throw new ApiError(
      402,
      "ENTITLEMENT_NOT_FOUND",
      "当前配置未包含此项资源权限",
    );
  await billingRepository.syncResourceUsage(
    organizationId,
    entitlementKey,
    current,
  );
  if (entitlement.limitAmount !== null && current >= entitlement.limitAmount)
    throw new ApiError(
      402,
      "ENTITLEMENT_LIMIT_REACHED",
      `${namesForErrors[entitlementKey]}数量已达到配置上限`,
    );
  return { current, limit: entitlement.limitAmount };
}
