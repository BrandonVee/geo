import { featureScopeAllowsPermission, type Permission } from "@geo/core";
import { ApiError } from "@/server/http/errors";
import { organizationFeatureScopeRepository } from "@/server/repositories/organization-feature-scopes";

/**
 * 显式功能范围只收窄 RBAC：没有配置时继承角色权限；配置后按模块 allowlist。
 */
export async function assertOrganizationFeatureEnabled(
  organizationId: string,
  userId: string,
  permission: Permission,
) {
  const scope = await organizationFeatureScopeRepository.find(
    organizationId,
    userId,
  );
  if (scope && !featureScopeAllowsPermission(scope.features, permission))
    throw new ApiError(
      403,
      "ORGANIZATION_FEATURE_DISABLED",
      "该用户未获目标企业的此项功能授权",
    );
}
