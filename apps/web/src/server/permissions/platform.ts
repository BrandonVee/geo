import { isPlatformTencentReady, type Permission } from "@geo/core";
import {
  db,
  permissions,
  platformAnswerbitCredentials,
  platformUserRoles,
  rolePermissions,
  roles,
} from "@geo/db";
import { and, eq } from "drizzle-orm";
import { ApiError } from "@/server/http/errors";

export async function requirePlatformPermission(
  userId: string,
  permission: Permission,
  options: { allowBeforeTencentConnection?: boolean } = {},
) {
  const [grant] = await db
    .select({ role: roles.code })
    .from(platformUserRoles)
    .innerJoin(roles, eq(roles.id, platformUserRoles.roleId))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(platformUserRoles.userId, userId),
        eq(roles.scope, "platform"),
        eq(permissions.code, permission),
      ),
    )
    .limit(1);
  if (!grant)
    throw new ApiError(403, "PLATFORM_PERMISSION_DENIED", "没有平台管理权限");
  if (!options.allowBeforeTencentConnection) {
    const [configuration] = await db
      .select({
        status: platformAnswerbitCredentials.status,
        teamId: platformAnswerbitCredentials.teamId,
      })
      .from(platformAnswerbitCredentials)
      .where(eq(platformAnswerbitCredentials.id, 1))
      .limit(1);
    if (!isPlatformTencentReady(configuration))
      throw new ApiError(
        422,
        "PLATFORM_TENCENT_CONNECTION_REQUIRED",
        "请先完成腾讯 TeamID 与 API Key 接入，再使用平台管理功能",
      );
  }
  return { userId, role: grant.role };
}

export async function isPlatformAdministrator(userId: string) {
  try {
    await requirePlatformPermission(userId, "platform.tenant.read", {
      allowBeforeTencentConnection: true,
    });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return false;
    throw error;
  }
}
