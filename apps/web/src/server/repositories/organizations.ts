import {
  answerbitBrandMappings,
  answerbitConnections,
  answerbitTeamBindings,
  db,
  memberRoles,
  organizationMembers,
  organizations,
  organizationUserFeatureScopes,
  brandAccess,
  roles,
} from "@geo/db";
import type { CreateOrganizationInput } from "@geo/contracts";
import { platformAnswerBitConnectionSentinel } from "@geo/core";
import { and, desc, eq, ne, sql } from "drizzle-orm";

export const organizationRepository = {
  listForUser(userId: string) {
    return db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        status: organizations.status,
        planCode: organizations.planCode,
        role: sql<
          string | null
        >`coalesce(${roles.code}, ${brandAccess.role}::text)`,
        features: organizationUserFeatureScopes.features,
        serviceExpiresAt: organizations.serviceExpiresAt,
        pointsExpiresAt: organizations.pointsExpiresAt,
        teamBindingId: answerbitBrandMappings.teamBindingId,
        answerbitBrandId: answerbitBrandMappings.brandId,
        answerbitBrandName: answerbitBrandMappings.brandName,
        createdAt: organizations.createdAt,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId),
      )
      .innerJoin(
        answerbitBrandMappings,
        eq(answerbitBrandMappings.organizationId, organizations.id),
      )
      .leftJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
      .leftJoin(roles, eq(roles.id, memberRoles.roleId))
      .leftJoin(
        brandAccess,
        and(
          eq(brandAccess.organizationId, organizations.id),
          eq(brandAccess.brandId, answerbitBrandMappings.brandId),
          eq(brandAccess.teamBindingId, answerbitBrandMappings.teamBindingId),
          eq(brandAccess.userId, organizationMembers.userId),
        ),
      )
      .leftJoin(
        organizationUserFeatureScopes,
        and(
          eq(organizationUserFeatureScopes.organizationId, organizations.id),
          eq(organizationUserFeatureScopes.userId, organizationMembers.userId),
        ),
      )
      .where(
        and(
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.status, "active"),
          ne(organizations.status, "closed"),
        ),
      )
      .orderBy(desc(organizations.createdAt));
  },
  async findMembershipRole(organizationId: string, userId: string) {
    const [membership] = await db
      .select({
        memberId: organizationMembers.id,
        role: roles.code,
        status: organizationMembers.status,
        organizationStatus: organizations.status,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId),
      )
      .innerJoin(
        answerbitBrandMappings,
        eq(answerbitBrandMappings.organizationId, organizations.id),
      )
      .leftJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
      .leftJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, userId),
        ),
      )
      .limit(1);
    return membership;
  },
  async findById(organizationId: string) {
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    return organization;
  },
  async findByAnswerbitBrandId(brandId: string) {
    const [projection] = await db
      .select({
        organization: organizations,
        brandName: answerbitBrandMappings.brandName,
      })
      .from(answerbitBrandMappings)
      .innerJoin(
        organizations,
        eq(organizations.id, answerbitBrandMappings.organizationId),
      )
      .where(eq(answerbitBrandMappings.brandId, brandId))
      .limit(1);
    return projection;
  },
  async updateTencentEnterpriseProjection(
    brandId: string,
    brandName: string,
    organizationName: string,
  ) {
    return db.transaction(async (tx) => {
      const now = new Date();
      const [mapping] = await tx
        .update(answerbitBrandMappings)
        .set({ brandName, syncedAt: now, updatedAt: now })
        .where(eq(answerbitBrandMappings.brandId, brandId))
        .returning({ organizationId: answerbitBrandMappings.organizationId });
      if (!mapping) return undefined;
      const [organization] = await tx
        .update(organizations)
        .set({ name: organizationName, updatedAt: now })
        .where(eq(organizations.id, mapping.organizationId))
        .returning();
      return organization;
    });
  },
  async createForUser(
    input: CreateOrganizationInput,
    userId: string,
    answerbit: {
      actorUserId: string;
      apiKeyHint: string;
      brandId: string;
      brandName: string;
      teamId: string;
    },
  ) {
    return db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values(input)
        .returning();
      const [member] = await tx
        .insert(organizationMembers)
        .values({
          organizationId: organization.id,
          userId,
          status: "active",
          joinedAt: new Date(),
        })
        .returning();
      const [existingRole] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, "tenant_admin"))
        .limit(1);
      const tenantRole =
        existingRole ??
        (
          await tx
            .insert(roles)
            .values({
              code: "tenant_admin",
              name: "企业管理员",
              scope: "organization",
            })
            .returning({ id: roles.id })
        )[0];
      await tx
        .insert(memberRoles)
        .values({ memberId: member.id, roleId: tenantRole.id });
      const now = new Date();
      const [connection] = await tx
        .insert(answerbitConnections)
        .values({
          organizationId: organization.id,
          encryptedApiKey: platformAnswerBitConnectionSentinel,
          apiKeyFingerprint: `${platformAnswerBitConnectionSentinel}:${organization.id}`,
          apiKeyHint: answerbit.apiKeyHint,
          status: "active",
          lastCheckedAt: now,
          managedByPlatform: true,
          createdBy: answerbit.actorUserId,
        })
        .returning();
      const [team] = await tx
        .insert(answerbitTeamBindings)
        .values({
          organizationId: organization.id,
          connectionId: connection.id,
          teamId: answerbit.teamId,
          displayName: "平台腾讯接入",
          isDefault: true,
          status: "active",
          brandCount: 1,
          lastCheckedAt: now,
          lastSyncedAt: now,
        })
        .returning();
      await tx.insert(answerbitBrandMappings).values({
        organizationId: organization.id,
        teamBindingId: team.id,
        brandId: answerbit.brandId,
        brandName: answerbit.brandName,
        syncedAt: now,
      });
      return organization;
    });
  },
};
