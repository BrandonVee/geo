import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { commitQuota, releaseQuota } from "./billing";
import { restoreBalance } from "./balances";
import {
  articleGenerationJobs,
  balanceTransactions,
  billingPlans,
  billingPlanVersions,
  organizations,
  platformSubscriptions,
  quotaLedgers,
  reportExports,
  subscriptionEntitlements,
} from "./schema";
import { db } from "./client";
const nextMonth = (start: Date) => {
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
};
export async function rolloverExpiredSubscriptions(now = new Date()) {
  const expired = await db
    .select({ id: platformSubscriptions.id })
    .from(platformSubscriptions)
    .where(
      and(
        eq(platformSubscriptions.status, "active"),
        lte(platformSubscriptions.currentPeriodEnd, now),
      ),
    );
  let rolledOver = 0;
  for (const item of expired)
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from ${platformSubscriptions} where ${platformSubscriptions.id} = ${item.id} for update`,
      );
      const [current] = await tx
        .select()
        .from(platformSubscriptions)
        .where(eq(platformSubscriptions.id, item.id))
        .limit(1);
      if (
        !current ||
        current.status !== "active" ||
        current.currentPeriodEnd > now
      )
        return;
      const [free] = await tx
        .select({ version: billingPlanVersions, plan: billingPlans })
        .from(billingPlanVersions)
        .innerJoin(
          billingPlans,
          eq(billingPlans.id, billingPlanVersions.planId),
        )
        .where(
          and(
            eq(billingPlans.code, "free"),
            eq(billingPlans.status, "active"),
            eq(billingPlanVersions.status, "published"),
            eq(billingPlanVersions.billingCycle, "free"),
          ),
        )
        .orderBy(desc(billingPlanVersions.version))
        .limit(1);
      if (!free) throw new Error("FREE_PLAN_NOT_CONFIGURED");
      const oldRights = await tx
        .select()
        .from(subscriptionEntitlements)
        .where(eq(subscriptionEntitlements.subscriptionId, current.id));
      if (oldRights.some((right) => right.reservedAmount > 0)) return;
      await tx
        .update(platformSubscriptions)
        .set({ status: "expired", updatedAt: now })
        .where(eq(platformSubscriptions.id, current.id));
      for (const right of oldRights) {
        const available =
          right.limitAmount === null
            ? 0
            : Math.max(0, right.limitAmount - right.usedAmount);
        await tx
          .insert(quotaLedgers)
          .values({
            organizationId: current.organizationId,
            subscriptionId: current.id,
            entitlementId: right.id,
            entitlementKey: right.entitlementKey,
            operation: "expire",
            amount: -available,
            balanceAfter: 0,
            referenceType: "subscription_expiration",
            referenceId: current.id,
            idempotencyKey: `subscription:${current.id}:expire:${right.entitlementKey}`,
            reason: "订阅周期到期，未使用额度失效",
          })
          .onConflictDoNothing();
      }
      const end = nextMonth(now);
      const [subscription] = await tx
        .insert(platformSubscriptions)
        .values({
          organizationId: current.organizationId,
          planVersionId: free.version.id,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: end,
        })
        .returning();
      for (const [key, value] of Object.entries(free.version.entitlements)) {
        const [right] = await tx
          .insert(subscriptionEntitlements)
          .values({
            organizationId: current.organizationId,
            subscriptionId: subscription.id,
            entitlementKey: key,
            limitAmount: value.limit,
            unit: value.unit,
            periodStart: now,
            periodEnd: end,
          })
          .returning();
        await tx.insert(quotaLedgers).values({
          organizationId: current.organizationId,
          subscriptionId: subscription.id,
          entitlementId: right.id,
          entitlementKey: key,
          operation: "grant",
          amount: value.limit ?? 0,
          balanceAfter: value.limit,
          referenceType: "subscription_rollover",
          referenceId: subscription.id,
          idempotencyKey: `subscription:${subscription.id}:grant:${key}`,
          reason: "订阅到期后恢复免费套餐",
        });
      }
      await tx
        .update(organizations)
        .set({ planCode: "free", updatedAt: now })
        .where(eq(organizations.id, current.organizationId));
      rolledOver += 1;
    });
  return rolledOver;
}
export async function reconcileArticleQuota() {
  const jobs = await db
    .select({
      organizationId: articleGenerationJobs.organizationId,
      reservationKey: articleGenerationJobs.quotaReservationKey,
      status: articleGenerationJobs.status,
    })
    .from(articleGenerationJobs)
    .where(
      and(
        inArray(articleGenerationJobs.status, [
          "succeeded",
          "failed",
          "cancelled",
        ]),
        sql`${articleGenerationJobs.quotaReservationKey} is not null`,
      ),
    );
  let settled = 0;
  for (const job of jobs) {
    const result =
      job.status === "succeeded"
        ? await commitQuota(job.organizationId, job.reservationKey!)
        : await releaseQuota(job.organizationId, job.reservationKey!);
    if (result.ok) settled += 1;
  }
  return settled;
}
export async function reconcileArticlePointRestores() {
  const consumed = alias(balanceTransactions, "article_feature_consumption");
  const restored = alias(balanceTransactions, "article_feature_restore");
  const jobs = await db
    .select({
      id: articleGenerationJobs.id,
      organizationId: articleGenerationJobs.organizationId,
      brandId: articleGenerationJobs.brandId,
      requestedBy: articleGenerationJobs.requestedBy,
      amount: consumed.amount,
    })
    .from(articleGenerationJobs)
    .innerJoin(
      consumed,
      and(
        eq(consumed.organizationId, articleGenerationJobs.organizationId),
        eq(consumed.operation, "consume"),
        sql`${consumed.idempotencyKey} = 'feature:ai_article_generation:' || ${articleGenerationJobs.id}::text || ':consume'`,
      ),
    )
    .leftJoin(
      restored,
      and(
        eq(restored.organizationId, articleGenerationJobs.organizationId),
        eq(restored.operation, "restore"),
        sql`${restored.idempotencyKey} = 'feature:ai_article_generation:' || ${articleGenerationJobs.id}::text || ':restore'`,
      ),
    )
    .where(
      and(
        inArray(articleGenerationJobs.status, ["failed", "cancelled"]),
        isNull(restored.id),
      ),
    )
    .limit(100);
  let restoredCharges = 0;
  for (const job of jobs) {
    await restoreBalance({
      organizationId: job.organizationId,
      brandId: job.brandId,
      asset: "answerbit_points",
      amount: job.amount,
      referenceType: "feature_usage_failed",
      referenceId: job.id,
      idempotencyKey: `feature:ai_article_generation:${job.id}:restore`,
      reason: "AI 文章生成失败返还",
      actorUserId: job.requestedBy,
    });
    restoredCharges += 1;
  }
  return restoredCharges;
}
export async function reconcileReportQuota() {
  const jobs = await db
    .select({
      organizationId: reportExports.organizationId,
      reservationKey: reportExports.quotaReservationKey,
      status: reportExports.status,
    })
    .from(reportExports)
    .where(
      and(
        inArray(reportExports.status, ["succeeded", "failed"]),
        sql`${reportExports.quotaReservationKey} is not null`,
      ),
    );
  let settled = 0;
  for (const job of jobs) {
    const result =
      job.status === "succeeded"
        ? await commitQuota(job.organizationId, job.reservationKey!)
        : await releaseQuota(job.organizationId, job.reservationKey!);
    if (result.ok) settled += 1;
  }
  return settled;
}
export async function expireReportFiles(now = new Date()) {
  const rows = await db
    .update(reportExports)
    .set({ status: "expired", fileContent: null, updatedAt: now })
    .where(
      and(
        eq(reportExports.status, "succeeded"),
        lte(reportExports.expiresAt, now),
      ),
    )
    .returning({ id: reportExports.id });
  return rows.length;
}
export async function runBillingMaintenance(now = new Date()) {
  const [
    settledArticleQuotas,
    settledReportQuotas,
    restoredArticlePointCharges,
  ] = await Promise.all([
    reconcileArticleQuota(),
    reconcileReportQuota(),
    reconcileArticlePointRestores(),
  ]);
  const [rolledOverSubscriptions, expiredReportFiles] = await Promise.all([
    rolloverExpiredSubscriptions(now),
    expireReportFiles(now),
  ]);
  return {
    rolledOverSubscriptions,
    settledArticleQuotas,
    settledReportQuotas,
    restoredArticlePointCharges,
    expiredReportFiles,
  };
}
