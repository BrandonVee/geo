import { createHash } from "node:crypto";
import {
  advanceTencentBrandMissingSync,
  platformAnswerBitConnectionSentinel,
} from "@geo/core";
import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import { db } from "./client";
import {
  answerbitBrandMappings,
  answerbitConnections,
  answerbitTeamBindings,
  billingPlans,
  billingPlanVersions,
  memberRoles,
  organizationMembers,
  organizations,
  platformAnswerbitBrands,
  platformAnswerbitCredentials,
  platformSubscriptions,
  quotaLedgers,
  roles,
  subscriptionEntitlements,
} from "./schema";

export type TencentEnterpriseDirectoryBrand = { id: string; name: string };

const enterpriseSlug = (brandId: string) =>
  `tencent-${createHash("sha256").update(brandId).digest("hex").slice(0, 32)}`;

// @project-doc docs/interfaces/answerbit_integration.md#enterprise_directory_sync
/**
 * Reconciles a verified Tencent brand directory into internal tenant projections.
 * Callers must finish the upstream request before entering this database workflow.
 */
export async function syncTencentEnterpriseDirectory(input: {
  brands: TencentEnterpriseDirectoryBrand[];
  teamId: string;
  apiKeyHint: string;
  actorUserId: string;
  checkedAt: Date;
  expectedKeyVersion: number;
  completeDirectory: boolean;
}) {
  const brands = [
    ...new Map(input.brands.map((brand) => [brand.id, brand])).values(),
  ];

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('tencent-enterprise-directory-sync'))`,
    );
    const [configuration] = await tx
      .select({
        keyVersion: platformAnswerbitCredentials.keyVersion,
        status: platformAnswerbitCredentials.status,
        teamId: platformAnswerbitCredentials.teamId,
      })
      .from(platformAnswerbitCredentials)
      .where(eq(platformAnswerbitCredentials.id, 1))
      .limit(1);
    if (
      !configuration ||
      configuration.teamId !== input.teamId ||
      configuration.keyVersion !== input.expectedKeyVersion ||
      configuration.status !== "active"
    )
      return {
        skipped: true,
        createdEnterpriseCount: 0,
        updatedEnterpriseCount: 0,
        closedEnterpriseCount: 0,
        pendingMissingCount: 0,
        enterpriseCount: 0,
        organizations: [] as (typeof organizations.$inferSelect)[],
      };

    let createdEnterpriseCount = 0;
    let updatedEnterpriseCount = 0;
    let closedEnterpriseCount = 0;
    let pendingMissingCount = 0;
    let tenantRoleId: string | undefined;
    const projectedOrganizations: (typeof organizations.$inferSelect)[] = [];

    const provisionDefaultEntitlements = async (organizationId: string) => {
      const [activeSubscription] = await tx
        .select({ id: platformSubscriptions.id })
        .from(platformSubscriptions)
        .where(
          and(
            eq(platformSubscriptions.organizationId, organizationId),
            eq(platformSubscriptions.status, "active"),
          ),
        )
        .limit(1);
      if (activeSubscription) return;

      const [profile] = await tx
        .select({ version: billingPlanVersions })
        .from(billingPlanVersions)
        .innerJoin(
          billingPlans,
          eq(billingPlans.id, billingPlanVersions.planId),
        )
        .where(
          and(
            eq(billingPlans.code, "free"),
            eq(billingPlanVersions.status, "published"),
            eq(billingPlanVersions.billingCycle, "free"),
          ),
        )
        .orderBy(desc(billingPlanVersions.version))
        .limit(1);
      if (!profile) throw new Error("DEFAULT_ENTITLEMENT_PROFILE_NOT_FOUND");

      const periodStart = input.checkedAt;
      const periodEnd = new Date(periodStart);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      const [subscription] = await tx
        .insert(platformSubscriptions)
        .values({
          organizationId,
          planVersionId: profile.version.id,
          status: "active",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        })
        .returning();
      for (const [key, value] of Object.entries(profile.version.entitlements)) {
        const [entitlement] = await tx
          .insert(subscriptionEntitlements)
          .values({
            organizationId,
            subscriptionId: subscription!.id,
            entitlementKey: key,
            limitAmount: value.limit,
            unit: value.unit,
            periodStart,
            periodEnd,
          })
          .returning();
        await tx.insert(quotaLedgers).values({
          organizationId,
          subscriptionId: subscription!.id,
          entitlementId: entitlement!.id,
          entitlementKey: key,
          operation: "grant",
          amount: value.limit ?? 0,
          balanceAfter: value.limit,
          referenceType: "resource_profile",
          referenceId: subscription!.id,
          idempotencyKey: `resource-profile:${subscription!.id}:grant:${key}`,
          reason: "默认资源上限",
        });
      }
      await tx
        .update(organizations)
        .set({ planCode: "free", updatedAt: input.checkedAt })
        .where(eq(organizations.id, organizationId));
    };

    for (const brand of brands) {
      const organizationName = brand.name.slice(0, 100);
      await tx
        .insert(platformAnswerbitBrands)
        .values({
          brandId: brand.id,
          brandName: brand.name,
          missingSyncCount: 0,
          syncedAt: input.checkedAt,
        })
        .onConflictDoUpdate({
          target: platformAnswerbitBrands.brandId,
          set: {
            brandName: brand.name,
            missingSyncCount: 0,
            syncedAt: input.checkedAt,
            updatedAt: input.checkedAt,
          },
        });

      const [projection] = await tx
        .select({
          organization: organizations,
          brandName: answerbitBrandMappings.brandName,
        })
        .from(answerbitBrandMappings)
        .innerJoin(
          organizations,
          eq(organizations.id, answerbitBrandMappings.organizationId),
        )
        .where(eq(answerbitBrandMappings.brandId, brand.id))
        .limit(1);

      if (projection) {
        if (projection.organization.status === "closed") continue;
        if (
          projection.organization.name !== organizationName ||
          projection.brandName !== brand.name
        )
          updatedEnterpriseCount += 1;
        await tx
          .update(answerbitBrandMappings)
          .set({
            brandName: brand.name,
            syncedAt: input.checkedAt,
            updatedAt: input.checkedAt,
          })
          .where(eq(answerbitBrandMappings.brandId, brand.id));
        const [organization] = await tx
          .update(organizations)
          .set({ name: organizationName, updatedAt: input.checkedAt })
          .where(eq(organizations.id, projection.organization.id))
          .returning();
        await provisionDefaultEntitlements(projection.organization.id);
        projectedOrganizations.push(organization!);
        continue;
      }

      const [organization] = await tx
        .insert(organizations)
        .values({ name: organizationName, slug: enterpriseSlug(brand.id) })
        .onConflictDoNothing()
        .returning();
      if (!organization)
        throw new Error("TENCENT_ENTERPRISE_PROJECTION_CONFLICT");
      if (!tenantRoleId) {
        const [tenantRole] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.code, "tenant_admin"))
          .limit(1);
        if (!tenantRole) throw new Error("TENANT_ADMIN_ROLE_NOT_FOUND");
        tenantRoleId = tenantRole.id;
      }
      const [member] = await tx
        .insert(organizationMembers)
        .values({
          organizationId: organization.id,
          userId: input.actorUserId,
          status: "active",
          joinedAt: input.checkedAt,
        })
        .returning();
      await tx
        .insert(memberRoles)
        .values({ memberId: member!.id, roleId: tenantRoleId });
      const [connection] = await tx
        .insert(answerbitConnections)
        .values({
          organizationId: organization.id,
          encryptedApiKey: platformAnswerBitConnectionSentinel,
          apiKeyFingerprint: `${platformAnswerBitConnectionSentinel}:${organization.id}`,
          apiKeyHint: input.apiKeyHint,
          status: "active",
          lastCheckedAt: input.checkedAt,
          managedByPlatform: true,
          createdBy: input.actorUserId,
        })
        .returning();
      const [team] = await tx
        .insert(answerbitTeamBindings)
        .values({
          organizationId: organization.id,
          connectionId: connection!.id,
          teamId: input.teamId,
          displayName: "平台统一 TeamID",
          isDefault: true,
          status: "active",
          brandCount: 1,
          lastCheckedAt: input.checkedAt,
          lastSyncedAt: input.checkedAt,
        })
        .returning();
      await tx.insert(answerbitBrandMappings).values({
        organizationId: organization.id,
        teamBindingId: team!.id,
        brandId: brand.id,
        brandName: brand.name,
        syncedAt: input.checkedAt,
      });
      await provisionDefaultEntitlements(organization.id);
      createdEnterpriseCount += 1;
      projectedOrganizations.push({ ...organization, planCode: "free" });
    }

    if (input.completeDirectory) {
      const brandIds = brands.map((brand) => brand.id);
      const missing = await tx
        .select({
          brandId: platformAnswerbitBrands.brandId,
          missingSyncCount: platformAnswerbitBrands.missingSyncCount,
          organizationId: organizations.id,
        })
        .from(platformAnswerbitBrands)
        .innerJoin(
          answerbitBrandMappings,
          eq(answerbitBrandMappings.brandId, platformAnswerbitBrands.brandId),
        )
        .innerJoin(
          organizations,
          eq(organizations.id, answerbitBrandMappings.organizationId),
        )
        .where(
          and(
            ne(organizations.status, "closed"),
            brandIds.length
              ? notInArray(platformAnswerbitBrands.brandId, brandIds)
              : undefined,
          ),
        );
      for (const brand of missing) {
        const missingState = advanceTencentBrandMissingSync(
          brand.missingSyncCount,
        );
        await tx
          .update(platformAnswerbitBrands)
          .set({
            missingSyncCount: missingState.missingSyncCount,
            updatedAt: input.checkedAt,
          })
          .where(eq(platformAnswerbitBrands.brandId, brand.brandId));
        if (!missingState.shouldClose) {
          pendingMissingCount += 1;
          continue;
        }
        await tx
          .update(organizations)
          .set({ status: "closed", updatedAt: input.checkedAt })
          .where(eq(organizations.id, brand.organizationId));
        await tx
          .update(answerbitTeamBindings)
          .set({
            status: "disabled",
            isDefault: false,
            lastErrorCode: "ANSWERBIT_BRAND_MISSING_FROM_DIRECTORY",
            updatedAt: input.checkedAt,
          })
          .where(
            eq(answerbitTeamBindings.organizationId, brand.organizationId),
          );
        await tx
          .update(answerbitConnections)
          .set({ status: "disabled", updatedAt: input.checkedAt })
          .where(eq(answerbitConnections.organizationId, brand.organizationId));
        closedEnterpriseCount += 1;
      }

      await tx
        .update(platformAnswerbitCredentials)
        .set({
          status: "active",
          lastCheckedAt: input.checkedAt,
          lastSyncedAt: input.checkedAt,
          updatedAt: input.checkedAt,
        })
        .where(eq(platformAnswerbitCredentials.id, 1));
      await tx
        .update(answerbitConnections)
        .set({
          apiKeyHint: input.apiKeyHint,
          status: "active",
          lastCheckedAt: input.checkedAt,
          updatedAt: input.checkedAt,
        })
        .where(
          and(
            eq(
              answerbitConnections.encryptedApiKey,
              platformAnswerBitConnectionSentinel,
            ),
            sql`exists (select 1 from ${organizations} active_organization where active_organization.id = ${answerbitConnections.organizationId} and active_organization.status <> 'closed')`,
          ),
        );
      await tx
        .update(answerbitTeamBindings)
        .set({
          status: "active",
          lastErrorCode: null,
          lastCheckedAt: input.checkedAt,
          lastSyncedAt: input.checkedAt,
          updatedAt: input.checkedAt,
        })
        .where(
          and(
            eq(answerbitTeamBindings.teamId, input.teamId),
            sql`exists (select 1 from ${organizations} active_organization where active_organization.id = ${answerbitTeamBindings.organizationId} and active_organization.status <> 'closed')`,
          ),
        );
    }

    return {
      skipped: false,
      createdEnterpriseCount,
      updatedEnterpriseCount,
      closedEnterpriseCount,
      pendingMissingCount,
      enterpriseCount: projectedOrganizations.length,
      organizations: projectedOrganizations,
    };
  });
}
