import type { Permission } from "@geo/core";
import {
  db,
  permissions,
  platformUserRoles,
  rolePermissions,
  roles,
} from "@geo/db";
import { and, eq } from "drizzle-orm";
import { ApiError } from "@/server/http/errors";

export async function requirePlatformPermission(
  userId: string,
  permission: Permission,
  _options: { allowBeforeTencentConnection?: boolean } = {},
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
