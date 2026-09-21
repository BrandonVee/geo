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
  roles,
  users,
} from "@geo/db";
import { and, count, eq } from "drizzle-orm";

type MemberScopeInput = {
  role: AddOrganizationMemberInput["role"];
  teamBindingId?: string;
  brandId?: string;
};

type BrandAccessScopeInput = CreateBrandAccessInput & {
  teamBindingId: string;
  brandId: string;
};

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
    return db.transaction(async (tx) => {
      const [member] = await tx
        .insert(organizationMembers)
        .values({
          organizationId,
          userId,
          status: "active",
          joinedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            organizationMembers.organizationId,
            organizationMembers.userId,
          ],
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
    });
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
    const [row] = await db
      .select({ value: count() })
      .from(organizationMembers)
      .innerJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
      .innerJoin(
        roles,
        and(eq(roles.id, memberRoles.roleId), eq(roles.code, "tenant_admin")),
      )
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.status, "active"),
        ),
      );
    return Number(row.value);
  },

  async updateMember(
    organizationId: string,
    memberId: string,
    status: "active" | "disabled",
  ) {
    const [member] = await db
      .update(organizationMembers)
      .set({ status })
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.id, memberId),
        ),
      )
      .returning();
    return member;
  },

  async removeMember(organizationId: string, memberId: string, userId: string) {
    return db.transaction(async (tx) => {
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
    });
  },

  async addBrandAccess(
    organizationId: string,
    userId: string,
    input: BrandAccessScopeInput,
  ) {
    const [access] = await db
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

  async removeBrandAccess(
    organizationId: string,
    userId: string,
    accessId: string,
  ) {
    const deleted = await db
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
};
