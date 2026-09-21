import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import {
  answerbitTeamBindings,
  billingPlans,
  billingPlanVersions,
  db,
  organizationMembers,
  organizations,
  platformSubscriptions,
  quotaLedgers,
  subscriptionEntitlements,
} from "@geo/db";

export const billingRepository = {
  async provisionDefaultEntitlements(organizationId: string) {
    return db.transaction(async (tx) => {
      const [activeSubscription] = await tx
        .select()
        .from(platformSubscriptions)
        .where(
          and(
            eq(platformSubscriptions.organizationId, organizationId),
            eq(platformSubscriptions.status, "active"),
          ),
        )
        .limit(1);
      if (activeSubscription) return activeSubscription;

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
      const start = new Date();
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const [subscription] = await tx
        .insert(platformSubscriptions)
        .values({
          organizationId,
          planVersionId: profile.version.id,
          status: "active",
          currentPeriodStart: start,
          currentPeriodEnd: end,
        })
        .returning();
      for (const [key, value] of Object.entries(profile.version.entitlements)) {
        const [snapshot] = await tx
          .insert(subscriptionEntitlements)
          .values({
            organizationId,
            subscriptionId: subscription!.id,
            entitlementKey: key,
            limitAmount: value.limit,
            unit: value.unit,
            periodStart: start,
            periodEnd: end,
          })
          .returning();
        await tx.insert(quotaLedgers).values({
          organizationId,
          subscriptionId: subscription!.id,
          entitlementId: snapshot!.id,
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
        .set({ planCode: "free", updatedAt: new Date() })
        .where(eq(organizations.id, organizationId));
      return subscription!;
    });
  },
  async entitlement(organizationId: string, entitlementKey: string) {
    const [record] = await db
      .select({ entitlement: subscriptionEntitlements })
      .from(subscriptionEntitlements)
      .innerJoin(
        platformSubscriptions,
        eq(platformSubscriptions.id, subscriptionEntitlements.subscriptionId),
      )
      .where(
        and(
          eq(subscriptionEntitlements.organizationId, organizationId),
          eq(subscriptionEntitlements.entitlementKey, entitlementKey),
          eq(platformSubscriptions.status, "active"),
          gt(platformSubscriptions.currentPeriodEnd, new Date()),
        ),
      )
      .limit(1);
    return record?.entitlement;
  },
  async syncResourceUsage(
    organizationId: string,
    entitlementKey: "members" | "brands",
    usedAmount: number,
  ) {
    const entitlement = await this.entitlement(organizationId, entitlementKey);
    if (!entitlement) return;
    await db
      .update(subscriptionEntitlements)
      .set({ usedAmount, updatedAt: new Date() })
      .where(eq(subscriptionEntitlements.id, entitlement.id));
  },
  async resourceCount(
    organizationId: string,
    entitlementKey: "members" | "brands",
  ) {
    if (entitlementKey === "members") {
      const [members] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            ne(organizationMembers.status, "disabled"),
          ),
        );
      return members?.value ?? 0;
    }
    const [row] = await db
      .select({
        value: sql<number>`coalesce(sum(${answerbitTeamBindings.brandCount}), 0)::int`,
      })
      .from(answerbitTeamBindings)
      .where(
        and(
          eq(answerbitTeamBindings.organizationId, organizationId),
          ne(answerbitTeamBindings.status, "disabled"),
        ),
      );
    return row?.value ?? 0;
  },
};
