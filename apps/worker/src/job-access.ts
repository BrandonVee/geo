import {
  featureScopeAllowsPermission,
  hasActiveUserAccess,
  hasPermission,
  type Permission,
  type Role,
} from "@geo/core";
import {
  db,
  answerbitBrandMappings,
  answerbitTeamBindings,
  brandAccess,
  organizationMembers,
  organizationUserFeatureScopes,
  organizations,
  memberRoles,
  roles,
  users,
} from "@geo/db";
import { and, eq } from "drizzle-orm";

export class WorkerJobAccessError extends Error {
  constructor(
    public readonly code:
      | "JOB_PERMISSION_REVOKED"
      | "ORGANIZATION_FEATURE_DISABLED"
      | "BRAND_NOT_FOUND",
  ) {
    super(code);
  }
}

// @project-doc docs/domains/identity_and_access.md#queued_job_access
export async function assertWorkerJobAccess(input: {
  organizationId: string;
  teamBindingId: string;
  brandId: string;
  userId: string;
  permission: Permission;
}) {
  const memberships = await db
    .select({
      memberStatus: organizationMembers.status,
      organizationStatus: organizations.status,
      status: users.status,
      accountType: users.accountType,
      agentValidFrom: users.agentValidFrom,
      agentExpiresAt: users.agentExpiresAt,
      role: roles.code,
      features: organizationUserFeatureScopes.features,
    })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId),
    )
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .leftJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
    .leftJoin(roles, eq(roles.id, memberRoles.roleId))
    .leftJoin(
      organizationUserFeatureScopes,
      and(
        eq(
          organizationUserFeatureScopes.organizationId,
          organizationMembers.organizationId,
        ),
        eq(organizationUserFeatureScopes.userId, organizationMembers.userId),
      ),
    )
    .where(
      and(
        eq(organizationMembers.organizationId, input.organizationId),
        eq(organizationMembers.userId, input.userId),
      ),
    );
  const membership = memberships[0];
  if (
    !membership ||
    membership.memberStatus !== "active" ||
    membership.organizationStatus !== "active" ||
    !hasActiveUserAccess(membership)
  )
    throw new WorkerJobAccessError("JOB_PERMISSION_REVOKED");
  if (
    membership.features !== null &&
    !featureScopeAllowsPermission(membership.features, input.permission)
  )
    throw new WorkerJobAccessError("ORGANIZATION_FEATURE_DISABLED");
  const [brand] = await db
    .select({ id: answerbitBrandMappings.id })
    .from(answerbitBrandMappings)
    .innerJoin(
      answerbitTeamBindings,
      and(
        eq(answerbitTeamBindings.id, answerbitBrandMappings.teamBindingId),
        eq(
          answerbitTeamBindings.organizationId,
          answerbitBrandMappings.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(answerbitBrandMappings.organizationId, input.organizationId),
        eq(answerbitBrandMappings.teamBindingId, input.teamBindingId),
        eq(answerbitBrandMappings.brandId, input.brandId),
        eq(answerbitTeamBindings.status, "active"),
      ),
    )
    .limit(1);
  if (!brand) throw new WorkerJobAccessError("BRAND_NOT_FOUND");
  if (
    memberships.some(
      (row) => row.role && hasPermission(row.role as Role, input.permission),
    )
  )
    return;
  const [access] = await db
    .select({ role: brandAccess.role })
    .from(brandAccess)
    .where(
      and(
        eq(brandAccess.organizationId, input.organizationId),
        eq(brandAccess.teamBindingId, input.teamBindingId),
        eq(brandAccess.brandId, input.brandId),
        eq(brandAccess.userId, input.userId),
      ),
    )
    .limit(1);
  if (!access || !hasPermission(access.role as Role, input.permission))
    throw new WorkerJobAccessError("JOB_PERMISSION_REVOKED");
}
