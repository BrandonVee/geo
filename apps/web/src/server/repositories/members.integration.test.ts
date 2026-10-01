import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  billingPlans,
  billingPlanVersions,
  db,
  organizationMembers,
  memberRoles,
  roles,
  organizations,
  platformSubscriptions,
  pool,
  subscriptionEntitlements,
  users,
  sessions,
  organizationUserFeatureScopes,
} from "@geo/db";
import { memberRepository } from "./members";
import { adminRepository } from "./admin";

// Opt in only after a database release; all fixtures use fresh UUIDs.
describe.skipIf(process.env.MEMBER_CAPACITY_DB_TESTS !== "1")(
  "企业成员额度 PostgreSQL 并发回归",
  () => {
    const firstOrganizationId = randomUUID();
    const secondOrganizationId = randomUUID();
    const userIds = Array.from({ length: 5 }, () => randomUUID());
    let disabledMemberId: string;
    const administratorOrganizations: string[] = [];

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
          ...administratorOrganizations,
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

    it.each(["disable", "remove", "mixed"] as const)(
      "并发 %s 管理员操作始终保留一个有效管理员",
      async (operation) => {
        const organizationId = randomUUID();
        administratorOrganizations.push(organizationId);
        await db.insert(organizations).values({
          id: organizationId,
          name: "Administrator concurrency",
          slug: organizationId,
        });
        const [role] = await db
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.code, "tenant_admin"));
        const members = await db
          .insert(organizationMembers)
          .values(
            userIds.slice(1, 3).map((userId) => ({
              organizationId,
              userId,
              status: "active" as const,
            })),
          )
          .returning();
        await db
          .insert(memberRoles)
          .values(
            members.map((member) => ({ memberId: member.id, roleId: role.id })),
          );
        const results = await Promise.allSettled(
          members.map((member, index) =>
            operation === "remove" || (operation === "mixed" && index === 0)
              ? memberRepository.removeMember(
                  organizationId,
                  member.id,
                  member.userId,
                )
              : memberRepository.updateMember(
                  organizationId,
                  member.id,
                  "disabled",
                ),
          ),
        );
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        const rejected = results.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({ message: "LAST_TENANT_ADMIN" });
        expect(
          await memberRepository.countActiveTenantAdmins(organizationId),
        ).toBe(1);
        const [remaining] = await db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.status, "active"),
            ),
          );
        await expect(
          memberRepository.removeMember(
            organizationId,
            remaining.id,
            remaining.userId,
          ),
        ).rejects.toMatchObject({ message: "LAST_TENANT_ADMIN" });
        // Removing a disabled former administrator cannot reduce active capacity.
        const [disabled] = await db
          .select()
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.status, "disabled"),
            ),
          );
        if (disabled)
          await expect(
            memberRepository.removeMember(
              organizationId,
              disabled.id,
              disabled.userId,
            ),
          ).resolves.toBe(true);
        expect(
          await memberRepository.countActiveTenantAdmins(organizationId),
        ).toBe(1);
      },
    );

    async function administratorFixture(companyCount = 1) {
      const ids = [randomUUID(), randomUUID()];
      userIds.push(...ids);
      await db.insert(users).values(
        ids.map((id) => ({
          id,
          name: "Account handover",
          email: `${id}@test.invalid`,
          accountType: "agent" as const,
        })),
      );
      const [role] = await db
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.code, "tenant_admin"));
      const companies = [];
      for (let index = 0; index < companyCount; index++) {
        const id = randomUUID();
        administratorOrganizations.push(id);
        const name = `Handover ${id}`;
        await db.insert(organizations).values({ id, name, slug: id });
        const members = await db
          .insert(organizationMembers)
          .values(
            ids.map((userId) => ({
              organizationId: id,
              userId,
              status: "active" as const,
            })),
          )
          .returning();
        await db
          .insert(memberRoles)
          .values(
            members.map((member) => ({ memberId: member.id, roleId: role.id })),
          );
        companies.push({ id, name, members });
      }
      return { ids, companies, role };
    }

    it.each(["disabled", "scheduled", "expired"] as const)(
      "%s 账号不计为备用管理员，保护成员与账号停用",
      async (state) => {
        const { ids, companies } = await administratorFixture();
        const company = companies[0];
        await db
          .update(users)
          .set(
            state === "disabled"
              ? { status: "disabled" }
              : state === "scheduled"
                ? { agentValidFrom: new Date(Date.now() + 86_400_000) }
                : { agentExpiresAt: new Date(Date.now() - 86_400_000) },
          )
          .where(eq(users.id, ids[1]));
        expect(await memberRepository.countActiveTenantAdmins(company.id)).toBe(
          1,
        );
        await expect(
          memberRepository.updateMember(
            company.id,
            company.members[0].id,
            "disabled",
          ),
        ).rejects.toMatchObject({ message: "LAST_TENANT_ADMIN" });
        await expect(
          adminRepository.updateUser(ids[0], { status: "disabled" }),
        ).rejects.toMatchObject({
          message: "LAST_TENANT_ADMIN",
          organizations: [{ id: company.id, name: company.name }],
        });
        // Cleaning an unavailable former administrator does not remove a usable one.
        await expect(
          memberRepository.removeMember(
            company.id,
            company.members[1].id,
            ids[1],
          ),
        ).resolves.toBe(true);
        expect(await memberRepository.countActiveTenantAdmins(company.id)).toBe(
          1,
        );
      },
    );

    it("多企业账号停用逐家检查，冲突回滚会话与资料，交接后可停用", async () => {
      const { ids, companies } = await administratorFixture(2);
      await db
        .delete(memberRoles)
        .where(eq(memberRoles.memberId, companies[0].members[1].id));
      await db.insert(sessions).values({
        userId: ids[0],
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      await expect(
        adminRepository.updateUser(ids[0], {
          status: "disabled",
          name: "Should roll back",
        }),
      ).rejects.toMatchObject({
        message: "LAST_TENANT_ADMIN",
        organizations: [{ id: companies[0].id, name: companies[0].name }],
      });
      const [unchanged] = await db
        .select()
        .from(users)
        .where(eq(users.id, ids[0]));
      expect(unchanged).toMatchObject({
        status: "active",
        name: "Account handover",
      });
      expect(
        (await db.select().from(sessions).where(eq(sessions.userId, ids[0])))
          .length,
      ).toBe(1);
      await memberRepository.addExistingMember(companies[0].id, ids[1], {
        role: "tenant_admin",
      });
      await expect(
        adminRepository.updateUser(ids[0], { status: "disabled" }),
      ).resolves.toMatchObject({ status: "disabled" });
      expect(
        (await db.select().from(sessions).where(eq(sessions.userId, ids[0])))
          .length,
      ).toBe(0);
      for (const company of companies)
        expect(await memberRepository.countActiveTenantAdmins(company.id)).toBe(
          1,
        );
    });

    it.each(["member-disable", "member-remove", "account-disable"] as const)(
      "账号停用与 %s 交叉并发仍保留可登录的管理员",
      async (operation) => {
        const { ids, companies } = await administratorFixture();
        const company = companies[0];
        const results = await Promise.allSettled([
          adminRepository.updateUser(ids[0], { status: "disabled" }),
          operation === "account-disable"
            ? adminRepository.updateUser(ids[1], { status: "disabled" })
            : operation === "member-remove"
              ? memberRepository.removeMember(
                  company.id,
                  company.members[1].id,
                  ids[1],
                )
              : memberRepository.updateMember(
                  company.id,
                  company.members[1].id,
                  "disabled",
                ),
        ]);
        expect(
          results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        const rejected = results.find(
          (result) => result.status === "rejected",
        ) as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({ message: "LAST_TENANT_ADMIN" });
        expect(await memberRepository.countActiveTenantAdmins(company.id)).toBe(
          1,
        );
      },
    );

    it.each(["scheduled", "expired"] as const)(
      "将唯一管理员设为 %s 代理商时要求先交接，未来到期和资料修改可保存",
      async (state) => {
        const { ids, companies } = await administratorFixture();
        await db
          .delete(memberRoles)
          .where(eq(memberRoles.memberId, companies[0].members[1].id));
        await expect(
          adminRepository.updateUser(
            ids[0],
            state === "scheduled"
              ? { agentValidFrom: new Date(Date.now() + 86_400_000) }
              : { agentExpiresAt: new Date(Date.now() - 86_400_000) },
          ),
        ).rejects.toMatchObject({ message: "LAST_TENANT_ADMIN" });
        await expect(
          adminRepository.updateUser(ids[0], {
            name: "Future administrator",
            agentExpiresAt: new Date(Date.now() + 86_400_000),
          }),
        ).resolves.toMatchObject({ name: "Future administrator" });
        expect(
          await memberRepository.countActiveTenantAdmins(companies[0].id),
        ).toBe(1);
      },
    );

    it("恢复已停用账号与绑定客户管理员在事务内重新核对账户状态和类型", async () => {
      const { ids, companies } = await administratorFixture();
      await db
        .update(organizationMembers)
        .set({ status: "disabled" })
        .where(eq(organizationMembers.id, companies[0].members[1].id));
      await db
        .update(users)
        .set({ status: "disabled" })
        .where(eq(users.id, ids[1]));
      await expect(
        memberRepository.updateMember(
          companies[0].id,
          companies[0].members[1].id,
          "active",
        ),
      ).rejects.toMatchObject({ message: "ACCOUNT_DISABLED" });
      await db
        .update(users)
        .set({ status: "active", accountType: "customer" })
        .where(eq(users.id, ids[1]));
      await expect(
        memberRepository.addExistingMember(companies[0].id, ids[1], {
          role: "tenant_admin",
        }),
      ).rejects.toMatchObject({ message: "ACCOUNT_TYPE_MISMATCH" });
      await expect(
        adminRepository.updateUser(ids[0], { accountType: "customer" }),
      ).rejects.toMatchObject({ message: "ACCOUNT_TYPE_ROLE_CONFLICT" });
    });

    it("用户功能范围调整与移出企业并发不遗留已移出企业的授权", async () => {
      const { ids, companies } = await administratorFixture();
      const company = companies[0];
      const results = await Promise.allSettled([
        adminRepository.updateUser(ids[1], {}, [
          { organizationId: company.id, features: [] },
        ]),
        memberRepository.removeMember(
          company.id,
          company.members[1].id,
          ids[1],
        ),
      ]);
      expect(results[1].status).toBe("fulfilled");
      if (results[0].status === "rejected")
        expect(results[0].reason).toMatchObject({
          message: "USER_ORGANIZATION_SCOPE_INVALID",
        });
      expect(
        (
          await db
            .select()
            .from(organizationUserFeatureScopes)
            .where(eq(organizationUserFeatureScopes.userId, ids[1]))
        ).length,
      ).toBe(0);
      expect(await memberRepository.countActiveTenantAdmins(company.id)).toBe(
        1,
      );
    });

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
