import { getUserAccessState, type UserAccessFields } from "@geo/core";
import {
  db,
  memberRoles,
  organizationMembers,
  organizations,
  roles,
  users,
} from "@geo/db";
import { and, eq, inArray, ne } from "drizzle-orm";

export type MemberTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export class LastTenantAdministratorError extends Error {
  constructor(readonly organizations: { id: string; name: string }[]) {
    super("LAST_TENANT_ADMIN");
  }
}

// @project-doc docs/domains/identity_and_access.md#member_lifecycle
export async function lockMemberAccount(tx: MemberTransaction, userId: string) {
  const [account] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  return account;
}

export function assertMemberAccountEffective(
  account: UserAccessFields | undefined,
) {
  if (!account) throw new Error("USER_NOT_FOUND");
  const state = getUserAccessState(account);
  if (state === "disabled") throw new Error("ACCOUNT_DISABLED");
  if (state === "scheduled") throw new Error("AGENT_NOT_YET_VALID");
  if (state === "expired") throw new Error("AGENT_EXPIRED");
}

export async function lockUserOrganizations(
  tx: MemberTransaction,
  userId: string,
) {
  // The caller owns the user row first. Member writes use the same order, so
  // membership cannot change while this set is collected and locked.
  const memberships = await tx
    .select({ organizationId: organizationMembers.organizationId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId));
  const ids = memberships.map((member) => member.organizationId);
  if (!ids.length) return [];
  return tx
    .select({
      id: organizations.id,
      name: organizations.name,
      status: organizations.status,
    })
    .from(organizations)
    .where(inArray(organizations.id, ids))
    .orderBy(organizations.id)
    .for("update");
}

export async function effectiveTenantAdministrators(
  tx: MemberTransaction,
  organizationId: string,
  now = Date.now(),
) {
  const rows = await tx
    .select({
      memberId: organizationMembers.id,
      userId: users.id,
      status: users.status,
      accountType: users.accountType,
      agentValidFrom: users.agentValidFrom,
      agentExpiresAt: users.agentExpiresAt,
    })
    .from(organizationMembers)
    .innerJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
    .innerJoin(roles, eq(roles.id, memberRoles.roleId))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.status, "active"),
        eq(roles.code, "tenant_admin"),
      ),
    );
  return rows.filter((row) => getUserAccessState(row, now) === "active");
}

export async function assertAdministratorRemains(
  tx: MemberTransaction,
  organizationId: string,
  memberId: string,
) {
  const administrators = await effectiveTenantAdministrators(
    tx,
    organizationId,
  );
  if (administrators.length === 1 && administrators[0].memberId === memberId) {
    const [organization] = await tx
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    throw new LastTenantAdministratorError(organization ? [organization] : []);
  }
}

export async function assertAccountAdministratorHandover(
  tx: MemberTransaction,
  userId: string,
  current: UserAccessFields,
  next: UserAccessFields,
) {
  const now = Date.now();
  if (
    getUserAccessState(current, now) !== "active" ||
    getUserAccessState(next, now) === "active"
  )
    return;
  const memberships = await tx
    .select({ id: organizations.id, name: organizations.name })
    .from(organizationMembers)
    .innerJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
    .innerJoin(roles, eq(roles.id, memberRoles.roleId))
    .innerJoin(
      organizations,
      eq(organizations.id, organizationMembers.organizationId),
    )
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "active"),
        eq(roles.code, "tenant_admin"),
        ne(organizations.status, "closed"),
      ),
    )
    .orderBy(organizations.id);
  const affected: { id: string; name: string }[] = [];
  for (const organization of memberships) {
    const administrators = await effectiveTenantAdministrators(
      tx,
      organization.id,
      now,
    );
    if (!administrators.some((member) => member.userId !== userId))
      affected.push(organization);
  }
  if (affected.length) throw new LastTenantAdministratorError(affected);
}
