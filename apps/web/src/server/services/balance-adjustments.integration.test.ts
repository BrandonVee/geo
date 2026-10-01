import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  organizations,
  users,
  balanceAccounts,
  balanceTransactions,
  operationLogs,
} from "@geo/db";
import { balanceService } from "./balances";

vi.mock("@/server/permissions/platform", () => ({
  requirePlatformPermission: vi.fn(),
}));

describe.skipIf(process.env.BALANCE_ADJUSTMENT_DB_TESTS !== "1")(
  "平台资产调整事务 PostgreSQL 回归",
  () => {
    const userId = randomUUID();
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Disposable QA database required");
      await db.insert(users).values({
        id: userId,
        name: "Asset adjustment QA",
        email: `${userId}@test.invalid`,
      });
    });
    async function fixture() {
      const organizationId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "Asset adjustment QA",
        slug: organizationId,
      });
      await db
        .insert(balanceAccounts)
        .values({ organizationId, asset: "answerbit_points", balance: 100 });
      return {
        organizationId,
        asset: "answerbit_points" as const,
        amount: 17,
        reason: "人工账本纠错",
        idempotencyKey: randomUUID(),
      };
    }
    const audit = () => ({ actorUserId: userId, requestId: randomUUID() });
    async function state(organizationId: string) {
      return {
        accounts: await db
          .select()
          .from(balanceAccounts)
          .where(eq(balanceAccounts.organizationId, organizationId)),
        transactions: await db
          .select()
          .from(balanceTransactions)
          .where(eq(balanceTransactions.organizationId, organizationId)),
        logs: await db
          .select()
          .from(operationLogs)
          .where(eq(operationLogs.organizationId, organizationId)),
      };
    }
    for (const operation of ["grant", "deduct"] as const) {
      it(`${operation} 并发同键只改变一次余额、流水和审计，核对返回原记录`, async () => {
        const input = await fixture();
        const results = await Promise.all([
          balanceService[operation](input, userId, audit()),
          balanceService[operation](input, userId, audit()),
        ]);
        expect(results.filter((r) => r.replayed)).toHaveLength(1);
        const current = await state(input.organizationId);
        expect(current.accounts[0].balance).toBe(
          operation === "grant" ? 117 : 83,
        );
        expect(current.transactions).toHaveLength(1);
        expect(current.logs).toHaveLength(1);
        expect(current.logs[0].resourceId).toBe(current.transactions[0].id);
        expect(await balanceService.confirmation(input, userId)).toMatchObject({
          id: current.transactions[0].id,
          idempotencyKey: input.idempotencyKey,
          actorUserId: userId,
          brandId: null,
        });
        expect(
          await balanceService.confirmation(
            { ...input, organizationId: randomUUID() },
            userId,
          ),
        ).toBeNull();
      });
      it(`${operation} 同键变更金额、原因、资产、操作人或操作类型均拒绝`, async () => {
        const input = await fixture();
        await balanceService[operation](input, userId, audit());
        for (const change of [
          { amount: 18 },
          { reason: "另外一次调整" },
          { asset: "publication_cny" as const },
        ])
          await expect(
            balanceService[operation]({ ...input, ...change }, userId, audit()),
          ).rejects.toMatchObject({
            status: 409,
            code: "IDEMPOTENCY_CONFLICT",
          });
        await expect(
          balanceService[operation](input, randomUUID(), audit()),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        await expect(
          balanceService[operation === "grant" ? "deduct" : "grant"](
            input,
            userId,
            audit(),
          ),
        ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
        const current = await state(input.organizationId);
        expect(current.transactions).toHaveLength(1);
        expect(current.logs).toHaveLength(1);
      });
      it(`${operation} 审计写入失败会回滚余额和流水，原键可以重新完成`, async () => {
        const input = await fixture();
        await expect(
          balanceService[operation](input, userId, {
            ...audit(),
            actorUserId: randomUUID(),
          }),
        ).rejects.toThrow();
        const current = await state(input.organizationId);
        expect(current.accounts[0].balance).toBe(100);
        expect(current.transactions).toHaveLength(0);
        expect(current.logs).toHaveLength(0);
        expect(await balanceService.confirmation(input, userId)).toBeNull();
        await expect(
          balanceService[operation](input, userId, audit()),
        ).resolves.toMatchObject({ replayed: false });
      });
    }
    it("余额不足拒绝扣减；冻结与期限到期仍允许管理员纠错", async () => {
      const input = await fixture();
      await expect(
        balanceService.deduct({ ...input, amount: 101 }, userId, audit()),
      ).rejects.toMatchObject({ status: 422, code: "INSUFFICIENT_BALANCE" });
      expect((await state(input.organizationId)).transactions).toHaveLength(0);
      await db
        .update(organizations)
        .set({
          status: "suspended",
          serviceExpiresAt: new Date("2020-01-01"),
          pointsExpiresAt: new Date("2020-01-01"),
        })
        .where(eq(organizations.id, input.organizationId));
      await balanceService.deduct(input, userId, audit());
      expect((await state(input.organizationId)).accounts[0].balance).toBe(83);
    });
    it("入账不存在的账户时，审计异常连新账户一并回滚", async () => {
      const input = await fixture();
      await expect(
        balanceService.grant({ ...input, asset: "publication_cny" }, userId, {
          ...audit(),
          actorUserId: randomUUID(),
        }),
      ).rejects.toThrow();
      expect(
        await db
          .select()
          .from(balanceAccounts)
          .where(
            and(
              eq(balanceAccounts.organizationId, input.organizationId),
              eq(balanceAccounts.asset, "publication_cny"),
            ),
          ),
      ).toHaveLength(0);
    });
  },
);
