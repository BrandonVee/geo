import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  billingPlans,
  billingPlanVersions,
  db,
  organizationMembers,
  organizations,
  platformSubscriptions,
  pool,
  subscriptionEntitlements,
  users,
} from "@geo/db";
import { memberRepository } from "./members";

// Opt in only after a database release; all fixtures use fresh UUIDs.
describe.skipIf(process.env.MEMBER_CAPACITY_DB_TESTS !== "1")(
  "企业成员额度 PostgreSQL 并发回归",
  () => {
    const firstOrganizationId = randomUUID();
    const secondOrganizationId = randomUUID();
    const userIds = Array.from({ length: 5 }, () => randomUUID());
    let disabledMemberId: string;

    beforeAll(async () => {
      const [plan] = await db
        .select({ id: billingPlanVersions.id })
        .from(billingPlanVersions)
        .innerJoin(
          billingPlans,
          eq(billingPlans.id, billingPlanVersions.planId),
        )
        .where(
          and(
            eq(billingPlans.code, "free"),
            eq(billingPlanVersions.status, "published"),
          ),
        )
        .limit(1);
      if (!plan) throw new Error("Database release seed is required");

      await db.insert(users).values(
        userIds.map((id) => ({
          id,
          name: "Member capacity test",
          email: `${id}@test.invalid`,
          accountType: "agent" as const,
        })),
      );
      for (const organizationId of [
        firstOrganizationId,
        secondOrganizationId,
      ]) {
        await db.insert(organizations).values({
          id: organizationId,
          name: "Member capacity test",
          slug: organizationId,
        });
        const periodStart = new Date();
        const periodEnd = new Date(periodStart.getTime() + 86_400_000);
        const [subscription] = await db
          .insert(platformSubscriptions)
          .values({
            organizationId,
            planVersionId: plan.id,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          })
          .returning({ id: platformSubscriptions.id });
        await db.insert(subscriptionEntitlements).values({
          organizationId,
          subscriptionId: subscription.id,
          entitlementKey: "members",
          limitAmount: 2,
          unit: "people",
          periodStart,
          periodEnd,
        });
        await db.insert(organizationMembers).values({
          organizationId,
          userId: userIds[0],
          status: "active",
        });
      }
      const [disabled] = await db
        .insert(organizationMembers)
        .values({
          organizationId: secondOrganizationId,
          userId: userIds[3],
          status: "disabled",
        })
        .returning({ id: organizationMembers.id });
      disabledMemberId = disabled.id;
    });

    afterAll(async () => {
      try {
        for (const organizationId of [
          firstOrganizationId,
          secondOrganizationId,
        ]) {
          await db
            .delete(organizationMembers)
            .where(eq(organizationMembers.organizationId, organizationId));
          await db
            .delete(subscriptionEntitlements)
            .where(eq(subscriptionEntitlements.organizationId, organizationId));
          await db
            .delete(platformSubscriptions)
            .where(eq(platformSubscriptions.organizationId, organizationId));
          await db
            .delete(organizations)
            .where(eq(organizations.id, organizationId));
        }
        await db.delete(users).where(inArray(users.id, userIds));
      } finally {
        await pool.end();
      }
    });

    async function activeCount(organizationId: string) {
      const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.status, "active"),
          ),
        );
      return row.value;
    }

    it("并发新增成员只能占用最后一个名额", async () => {
      const results = await Promise.allSettled([
        memberRepository.addExistingMember(firstOrganizationId, userIds[1], {
          role: "tenant_admin",
        }),
        memberRepository.addExistingMember(firstOrganizationId, userIds[2], {
          role: "tenant_admin",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        message: "ENTITLEMENT_LIMIT_REACHED",
      });
      expect(await activeCount(firstOrganizationId)).toBe(2);
    });

    it("并发恢复和新增成员也只能占用最后一个名额", async () => {
      const results = await Promise.allSettled([
        memberRepository.updateMember(
          secondOrganizationId,
          disabledMemberId,
          "active",
        ),
        memberRepository.addExistingMember(secondOrganizationId, userIds[4], {
          role: "tenant_admin",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toMatchObject({
        message: "ENTITLEMENT_LIMIT_REACHED",
      });
      expect(await activeCount(secondOrganizationId)).toBe(2);
    });
  },
);
