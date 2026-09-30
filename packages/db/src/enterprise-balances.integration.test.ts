import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "./client";
import {
  organizations,
  users,
  balanceAccounts,
  balanceTransactions,
} from "./schema";
import { consumeBalance, deductBalance, restoreBalance } from "./balances";
import { assertEnterpriseAccess } from "./enterprise-access";
describe.skipIf(process.env.ENTERPRISE_BALANCE_DB_TESTS !== "1")(
  "企业到期与人工扣减事务",
  () => {
    const org = randomUUID(),
      user = randomUUID();
    const debit = {
      organizationId: org,
      asset: "answerbit_points" as const,
      amount: 100,
      reason: "人工扣减测试",
      actorUserId: user,
      idempotencyKey: randomUUID(),
    };
    beforeAll(async () => {
      await db
        .insert(users)
        .values({ id: user, name: "test", email: `${user}@test.invalid` });
      await db
        .insert(organizations)
        .values({ id: org, name: "test", slug: org });
      await db.insert(balanceAccounts).values([
        { organizationId: org, asset: "answerbit_points", balance: 150 },
        {
          organizationId: org,
          brandId: "brand",
          asset: "publication_cny",
          balance: 200,
        },
      ]);
    });
    afterAll(async () => {
      await db
        .delete(balanceTransactions)
        .where(eq(balanceTransactions.organizationId, org));
      await db
        .delete(balanceAccounts)
        .where(eq(balanceAccounts.organizationId, org));
      await db.delete(organizations).where(eq(organizations.id, org));
      await db.delete(users).where(eq(users.id, user));
      await pool.end();
    });
    it("并发同键只扣一次，参数变更冲突，不足不写流水", async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, () => deductBalance(debit)),
      );
      expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
      expect(await deductBalance({ ...debit, amount: 1 })).toMatchObject({
        ok: false,
        code: "IDEMPOTENCY_CONFLICT",
      });
      expect(
        await deductBalance({ ...debit, idempotencyKey: randomUUID() }),
      ).toMatchObject({ ok: false, code: "INSUFFICIENT_BALANCE" });
    });
    it("不同幂等键并发扣减不能透支", async () => {
      const results = await Promise.all(
        [1, 2].map(() =>
          deductBalance({ ...debit, amount: 40, idempotencyKey: randomUUID() }),
        ),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toHaveLength(1);
    });
    it("企业到期不消费，管理员可扣减，退款仍可到账", async () => {
      await db
        .update(organizations)
        .set({ serviceExpiresAt: new Date(0) })
        .where(eq(organizations.id, org));
      await expect(assertEnterpriseAccess(org)).rejects.toMatchObject({
        code: "ORGANIZATION_EXPIRED",
      });
      const usage = {
        organizationId: org,
        brandId: "brand",
        asset: "publication_cny" as const,
        amount: 1,
        referenceType: "test",
        referenceId: "test",
        idempotencyKey: randomUUID(),
        reason: "test",
      };
      await expect(consumeBalance(usage)).rejects.toMatchObject({
        code: "ORGANIZATION_EXPIRED",
      });
      await expect(
        deductBalance({
          ...debit,
          brandId: "brand",
          asset: "publication_cny",
          amount: 25,
          idempotencyKey: randomUUID(),
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        restoreBalance({ ...usage, idempotencyKey: randomUUID() }),
      ).resolves.toBeDefined();
    });
    it("积分到期不消费，续期后恢复；人民币账户不受积分到期影响", async () => {
      await db
        .update(organizations)
        .set({
          serviceExpiresAt: new Date(Date.now() + 100000),
          pointsExpiresAt: new Date(0),
        })
        .where(eq(organizations.id, org));
      const usage = {
        organizationId: org,
        asset: "answerbit_points" as const,
        amount: 1,
        referenceType: "test",
        referenceId: "test",
        idempotencyKey: randomUUID(),
        reason: "test",
      };
      await expect(consumeBalance(usage)).rejects.toMatchObject({
        code: "POINTS_EXPIRED",
      });
      await expect(
        consumeBalance({
          ...usage,
          asset: "publication_cny",
          brandId: "brand",
          idempotencyKey: randomUUID(),
        }),
      ).resolves.toMatchObject({ ok: true });
      await db
        .update(organizations)
        .set({ pointsExpiresAt: new Date(Date.now() + 100000) })
        .where(eq(organizations.id, org));
      await expect(consumeBalance(usage)).resolves.toMatchObject({ ok: true });
    });
  },
);
