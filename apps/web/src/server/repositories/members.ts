import type {
  AddOrganizationMemberInput,
  CreateBrandAccessInput,
} from "@geo/contracts";
import {
  answerbitBrandMappings,
  answerbitTeamBindings,
  brandAccess,
  db,
  memberRoles,
  organizationMembers,
  organizationUserFeatureScopes,
  organizations,
  platformSubscriptions,
  roles,
  subscriptionEntitlements,
  users,
} from "@geo/db";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import {
  lockMemberAccount,
  assertMemberAccountEffective,
  assertAdministratorRemains,
  effectiveTenantAdministrators,
} from "./member-lifecycle";
import { insertLocalAccount } from "@/server/modules/identity/identity.repository";

type MemberScopeInput = {
  role: AddOrganizationMemberInput["role"];
  teamBindingId?: string;
  brandId?: string;
};

type BrandAccessScopeInput = CreateBrandAccessInput & {
  teamBindingId: string;
  brandId: string;
};

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockOrganization(tx: Transaction, organizationId: string) {
  const [organization] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .for("update");
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
}

async function assertMemberCapacity(tx: Transaction, organizationId: string) {
  const [entitlement] = await tx
    .select({ limitAmount: subscriptionEntitlements.limitAmount })
    .from(subscriptionEntitlements)
    .innerJoin(
      platformSubscriptions,
      eq(platformSubscriptions.id, subscriptionEntitlements.subscriptionId),
    )
    .where(
      and(
        eq(subscriptionEntitlements.organizationId, organizationId),
        eq(subscriptionEntitlements.entitlementKey, "members"),
        eq(platformSubscriptions.status, "active"),
        gt(platformSubscriptions.currentPeriodEnd, new Date()),
      ),
    )
    .limit(1);
  if (!entitlement) throw new Error("ENTITLEMENT_NOT_FOUND");
  if (entitlement.limitAmount === null) return;

  const [current] = await tx
    .select({ value: sql<number>`count(*)::int` })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        ne(organizationMembers.status, "disabled"),
      ),
    );
  if ((current?.value ?? 0) >= entitlement.limitAmount)
    throw new Error("ENTITLEMENT_LIMIT_REACHED");
}

async function countActiveAgentEnterprises(tx: Transaction, userId: string) {
  const [row] = await tx
    .select({
      value: sql<number>`count(distinct ${organizationMembers.organizationId})::int`,
    })
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
    );
  return row?.value ?? 0;
}

async function upsertMember(
  tx: Transaction,
  organizationId: string,
  userId: string,
  input: MemberScopeInput,
) {
  const account = await lockMemberAccount(tx, userId);
  assertMemberAccountEffective(account);
  if (input.role === "tenant_admin" && account?.accountType === "customer")
    throw new Error("ACCOUNT_TYPE_MISMATCH");
  if (input.role !== "tenant_admin" && account?.accountType === "agent")
    throw new Error("ACCOUNT_TYPE_MISMATCH");
  await lockOrganization(tx, organizationId);
  const [existing] = await tx
    .select({ status: organizationMembers.status })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!existing || existing.status === "disabled")
    await assertMemberCapacity(tx, organizationId);

  let agentEnterpriseLimit: number | null = null;
  let priorAgentEnterpriseCount = 0;
  if (input.role === "tenant_admin" && account?.accountType === "agent") {
    agentEnterpriseLimit = account.agentEnterpriseLimit;
    if (agentEnterpriseLimit !== null)
      priorAgentEnterpriseCount = await countActiveAgentEnterprises(tx, userId);
  }
  const [member] = await tx
    .insert(organizationMembers)
    .values({
      organizationId,
      userId,
      status: "active",
      joinedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [organizationMembers.organizationId, organizationMembers.userId],
      set: { status: "active", joinedAt: new Date() },
    })
    .returning();

  if (input.role === "tenant_admin") {
    const [role] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, "tenant_admin"))
      .limit(1);
    if (!role) throw new Error("TENANT_ADMIN_ROLE_NOT_SEEDED");
    await tx
      .insert(memberRoles)
      .values({ memberId: member.id, roleId: role.id })
      .onConflictDoNothing();
    if (agentEnterpriseLimit !== null) {
      const nextCount = await countActiveAgentEnterprises(tx, userId);
      if (
        nextCount > priorAgentEnterpriseCount &&
        nextCount > agentEnterpriseLimit
      )
        throw new Error("AGENT_ENTERPRISE_QUOTA_EXCEEDED");
    }
  } else {
    await tx
      .insert(brandAccess)
      .values({
        organizationId,
        userId,
        teamBindingId: input.teamBindingId!,
        brandId: input.brandId!,
        role: input.role,
      })
      .onConflictDoUpdate({
        target: [
          brandAccess.organizationId,
          brandAccess.teamBindingId,
          brandAccess.brandId,
          brandAccess.userId,
        ],
        set: { role: input.role },
      });
  }

  return member;
}

export const memberRepository = {
  async findUserByUsername(username: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return user;
  },

  async findUserById(userId: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user;
  },

  listMemberRows(organizationId: string) {
    return db
      .select({
        memberId: organizationMembers.id,
        userId: users.id,
        name: users.name,
        username: users.username,
        accountStatus: users.status,
        accountType: users.accountType,
        agentValidFrom: users.agentValidFrom,
        agentExpiresAt: users.agentExpiresAt,
        memberStatus: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
        createdAt: organizationMembers.createdAt,
        organizationRole: roles.code,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .leftJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
      .leftJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(eq(organizationMembers.organizationId, organizationId))
      .orderBy(organizationMembers.createdAt);
  },

  listBrandAccess(organizationId: string) {
    return db
      .select({
        id: brandAccess.id,
        userId: brandAccess.userId,
        brandId: brandAccess.brandId,
        role: brandAccess.role,
        createdAt: brandAccess.createdAt,
      })
      .from(brandAccess)
      .where(eq(brandAccess.organizationId, organizationId));
  },

  async findActiveBrandScope(organizationId: string) {
    const [scope] = await db
      .select({
        teamBindingId: answerbitTeamBindings.id,
        brandId: answerbitBrandMappings.brandId,
      })
      .from(answerbitBrandMappings)
      .innerJoin(
        answerbitTeamBindings,
        and(
          eq(answerbitTeamBindings.id, answerbitBrandMappings.teamBindingId),
          eq(answerbitTeamBindings.organizationId, organizationId),
          eq(answerbitTeamBindings.status, "active"),
        ),
      )
      .where(eq(answerbitBrandMappings.organizationId, organizationId))
      .limit(1);
    return scope;
  },

  async addExistingMember(
    organizationId: string,
    userId: string,
    input: MemberScopeInput,
  ) {
    return db.transaction(
      (tx) => upsertMember(tx, organizationId, userId, input),
      { isolationLevel: "read committed" },
    );
  },

  async createCustomerMember(
    organizationId: string,
    input: {
      name: string;
      username: string;
      passwordHash: string;
      role: "brand_admin" | "brand_editor" | "brand_viewer";
      teamBindingId: string;
      brandId: string;
    },
  ) {
    return db.transaction(
      async (tx) => {
        const user = await insertLocalAccount(tx, {
          name: input.name,
          username: input.username,
          passwordHash: input.passwordHash,
          accountType: "customer",
          pricingTier: "retail",
        });
        const member = await upsertMember(tx, organizationId, user.id, input);
        return { user, member };
      },
      { isolationLevel: "read committed" },
    );
  },

  async findMember(organizationId: string, memberId: string) {
    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.id, memberId),
        ),
      )
      .limit(1);
    return member;
  },

  async findMemberByUser(organizationId: string, userId: string) {
    const [member] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);
    return member;
  },

  async isTenantAdmin(memberId: string) {
    const [row] = await db
      .select({ id: memberRoles.memberId })
      .from(memberRoles)
      .innerJoin(
        roles,
        and(eq(roles.id, memberRoles.roleId), eq(roles.code, "tenant_admin")),
      )
      .where(eq(memberRoles.memberId, memberId))
      .limit(1);
    return Boolean(row);
  },

  async countActiveTenantAdmins(organizationId: string) {
    return db.transaction(
      async (tx) =>
        (await effectiveTenantAdministrators(tx, organizationId)).length,
    );
  },

  async updateMember(
    organizationId: string,
    memberId: string,
    status: "active" | "disabled",
  ) {
    return db.transaction(
      async (tx) => {
        const [target] = await tx
          .select({
            userId: organizationMembers.userId,
            status: organizationMembers.status,
          })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.id, memberId),
            ),
          );
        if (!target) return undefined;
        const account = await lockMemberAccount(tx, target.userId);
        if (status === "active") assertMemberAccountEffective(account);
        await lockOrganization(tx, organizationId);
        if (status === "disabled")
          await assertAdministratorRemains(tx, organizationId, memberId);
        const [current] = await tx
          .select({
            userId: organizationMembers.userId,
            status: organizationMembers.status,
          })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.id, memberId),
            ),
          );
        if (!current) return undefined;
        let agentEnterpriseLimit: number | null = null;
        let priorAgentEnterpriseCount = 0;
        if (current && current.status !== "active" && status === "active") {
          if (current.status === "disabled")
            await assertMemberCapacity(tx, organizationId);
          if (account?.accountType === "agent") {
            agentEnterpriseLimit = account.agentEnterpriseLimit;
            if (agentEnterpriseLimit !== null)
              priorAgentEnterpriseCount = await countActiveAgentEnterprises(
                tx,
                current.userId,
              );
          }
        }
        const [member] = await tx
          .update(organizationMembers)
          .set({ status })
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.id, memberId),
            ),
          )
          .returning();
        if (member && agentEnterpriseLimit !== null) {
          const nextCount = await countActiveAgentEnterprises(
            tx,
            member.userId,
          );
          if (
            nextCount > priorAgentEnterpriseCount &&
            nextCount > agentEnterpriseLimit
          )
            throw new Error("AGENT_ENTERPRISE_QUOTA_EXCEEDED");
        }
        return member;
      },
      { isolationLevel: "read committed" },
    );
  },

  async removeMember(organizationId: string, memberId: string, userId: string) {
    return db.transaction(
      async (tx) => {
        await lockMemberAccount(tx, userId);
        await lockOrganization(tx, organizationId);
        await assertAdministratorRemains(tx, organizationId, memberId);
        await tx
          .delete(brandAccess)
          .where(
            and(
              eq(brandAccess.organizationId, organizationId),
              eq(brandAccess.userId, userId),
            ),
          );
        await tx
          .delete(organizationUserFeatureScopes)
          .where(
            and(
              eq(organizationUserFeatureScopes.organizationId, organizationId),
              eq(organizationUserFeatureScopes.userId, userId),
            ),
          );
        const deleted = await tx
          .delete(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.id, memberId),
            ),
          )
          .returning({ id: organizationMembers.id });
        return Boolean(deleted.length);
      },
      { isolationLevel: "read committed" },
    );
  },

  async addBrandAccess(
    organizationId: string,
    userId: string,
    input: BrandAccessScopeInput,
  ) {
    return db.transaction(
      async (tx) => {
        const account = await lockMemberAccount(tx, userId);
        if (!account) throw new Error("USER_NOT_FOUND");
        if (account.accountType === "agent")
          throw new Error("ACCOUNT_TYPE_MISMATCH");
        await lockOrganization(tx, organizationId);
        const [member] = await tx
          .select({ id: organizationMembers.id })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.userId, userId),
            ),
          );
        if (!member) throw new Error("MEMBER_NOT_FOUND");
        const [access] = await tx
          .insert(brandAccess)
          .values({ organizationId, userId, ...input })
          .onConflictDoUpdate({
            target: [
              brandAccess.organizationId,
              brandAccess.teamBindingId,
              brandAccess.brandId,
              brandAccess.userId,
            ],
            set: { role: input.role },
          })
          .returning();
        return access;
      },
      { isolationLevel: "read committed" },
    );
  },
  async removeBrandAccess(
    organizationId: string,
    userId: string,
    accessId: string,
  ) {
    return db.transaction(
      async (tx) => {
        await lockMemberAccount(tx, userId);
        await lockOrganization(tx, organizationId);
        const deleted = await tx
          .delete(brandAccess)
          .where(
            and(
              eq(brandAccess.organizationId, organizationId),
              eq(brandAccess.userId, userId),
              eq(brandAccess.id, accessId),
            ),
          )
          .returning({ id: brandAccess.id });
        return Boolean(deleted.length);
      },
      { isolationLevel: "read committed" },
    );
  },
};
