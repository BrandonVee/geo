import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  organizations,
  users,
  balanceAccounts,
  balanceTransactions,
  operationLogs,
  answerbitConnections,
  answerbitTeamBindings,
  answerbitBrandMappings,
  allocateBalance,
  grantBalance,
} from "@geo/db";
import { balanceService } from "./balances";
import { writeAudit } from "@/server/audit/write-audit";

vi.mock("./organizations", () => ({
  organizationService: { authorize: vi.fn() },
}));

describe.skipIf(process.env.BALANCE_ALLOCATION_DB_TESTS !== "1")(
  "企业品牌划拨事务 PostgreSQL 回归",
  () => {
    const userId = randomUUID(),
      otherUserId = randomUUID();
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Disposable QA database required");
      await db.insert(users).values(
        [userId, otherUserId].map((id) => ({
          id,
          name: "Allocation QA",
          email: `${id}@test.invalid`,
          accountType: "agent" as const,
        })),
      );
    });
    afterAll(async () => {
      await pool.end();
    });
    async function fixture(
      asset: "answerbit_points" | "publication_cny" = "answerbit_points",
    ) {
      const organizationId = randomUUID(),
        brandId = `allocation-${randomUUID()}`;
      await db.insert(organizations).values({
        id: organizationId,
        name: "Allocation QA",
        slug: organizationId,
      });
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId,
          encryptedApiKey: "unused",
          apiKeyFingerprint: randomUUID(),
          apiKeyHint: "qa",
          createdBy: userId,
        })
        .returning();
      const [binding] = await db
        .insert(answerbitTeamBindings)
        .values({
          organizationId,
          connectionId: connection.id,
          teamId: `qa-${randomUUID()}`,
        })
        .returning();
      await db.insert(answerbitBrandMappings).values({
        organizationId,
        teamBindingId: binding.id,
        brandId,
        brandName: "Allocation QA",
      });
      await db
        .insert(balanceAccounts)
        .values({ organizationId, asset, balance: 100 });
      return {
        organizationId,
        brandId,
        asset,
        amount: 17,
        reason: "企业向品牌划拨",
        idempotencyKey: randomUUID(),
      };
    }
    const audit = (actorUserId = userId) => ({
      actorUserId,
      requestId: randomUUID(),
    });
    const state = async (organizationId: string) => ({
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
    });
    for (const asset of ["answerbit_points", "publication_cny"] as const) {
      it(`${asset} 并发同键只划拨一次，余额、流水、审计一起保存`, async () => {
        const input = await fixture(asset);
        const results = await Promise.all([
          balanceService.allocate(input, userId, audit()),
          balanceService.allocate(input, userId, audit()),
        ]);
        expect(results.filter((r) => r.replayed)).toHaveLength(1);
        const current = await state(input.organizationId);
        expect(current.accounts.find((a) => !a.brandId)?.balance).toBe(83);
        expect(
          current.accounts.find((a) => a.brandId === input.brandId)?.balance,
        ).toBe(17);
        expect(current.transactions).toHaveLength(1);
        expect(current.logs).toHaveLength(1);
        expect(current.logs[0]).toMatchObject({
          operation: "balance.allocate",
          resourceId: current.transactions[0].id,
        });
        expect(
          await balanceService.allocationConfirmation(input, userId),
        ).toMatchObject({
          id: current.transactions[0].id,
          brandId: input.brandId,
          actorUserId: userId,
        });
      });
      it(`${asset} 审计失败连新品牌账户一同回滚，原键可重试`, async () => {
        const input = await fixture(asset);
        await expect(
          balanceService.allocate(input, userId, audit(randomUUID())),
        ).rejects.toThrow();
        const current = await state(input.organizationId);
        expect(current.accounts).toHaveLength(1);
        expect(current.accounts[0].balance).toBe(100);
        expect(current.transactions).toHaveLength(0);
        expect(current.logs).toHaveLength(0);
        expect(
          await balanceService.allocationConfirmation(input, userId),
        ).toBeNull();
        await expect(
          balanceService.allocate(input, userId, audit()),
        ).resolves.toMatchObject({ replayed: false });
      });
    }
    it("同键不同金额、原因、资产、操作者、品牌或操作均拒绝，不追加审计", async () => {
      const input = await fixture();
      await balanceService.allocate(input, userId, audit());
      for (const change of [
        { amount: 18 },
        { reason: "另一笔划拨" },
        { asset: "publication_cny" as const },
      ])
        await expect(
          balanceService.allocate({ ...input, ...change }, userId, audit()),
        ).rejects.toMatchObject({ status: 409, code: "IDEMPOTENCY_CONFLICT" });
      await expect(
        balanceService.allocate(input, otherUserId, audit(otherUserId)),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect(
        await allocateBalance({
          ...input,
          brandId: "other-brand",
          actorUserId: userId,
        }),
      ).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
      const grantKey = randomUUID();
      await grantBalance({
        ...input,
        idempotencyKey: grantKey,
        actorUserId: userId,
      });
      await expect(
        balanceService.allocate(
          { ...input, idempotencyKey: grantKey },
          userId,
          audit(),
        ),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect((await state(input.organizationId)).logs).toHaveLength(1);
    });
    it("核对只返回本人在指定企业及品牌的划拨，不返回入账或其他操作者", async () => {
      const input = await fixture();
      await balanceService.allocate(input, userId, audit());
      expect(
        await balanceService.allocationConfirmation(input, otherUserId),
      ).toBeNull();
      expect(
        await balanceService.allocationConfirmation(
          { ...input, idempotencyKey: randomUUID() },
          userId,
        ),
      ).toBeNull();
      const second = await fixture();
      expect(
        await balanceService.allocationConfirmation(
          { ...second, idempotencyKey: input.idempotencyKey },
          userId,
        ),
      ).toBeNull();
      await expect(
        balanceService.allocationConfirmation(
          { ...input, brandId: second.brandId },
          userId,
        ),
      ).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
      const key = randomUUID();
      await grantBalance({
        ...input,
        idempotencyKey: key,
        actorUserId: userId,
      });
      expect(
        await balanceService.allocationConfirmation(
          { ...input, idempotencyKey: key },
          userId,
        ),
      ).toBeNull();
    });
    it("核对等待同键事务提交后再读取，不将处理中误判为未保存", async () => {
      const input = await fixture();
      let release!: () => void, reached!: () => void;
      const gate = new Promise<void>((resolve) => {
          release = resolve;
        }),
        arrived = new Promise<void>((resolve) => {
          reached = resolve;
        });
      const writing = allocateBalance(
        { ...input, actorUserId: userId },
        async (tx, transaction) => {
          await writeAudit(
            { ...audit(), organizationId: input.organizationId },
            {
              operation: "balance.allocate",
              resourceType: "balance_transaction",
              resourceId: transaction.id,
            },
            tx,
          );
          reached();
          await gate;
        },
      );
      await arrived;
      let settled = false;
      const confirmation = balanceService
        .allocationConfirmation(input, userId)
        .then((result) => {
          settled = true;
          return result;
        });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(settled).toBe(false);
      release();
      await writing;
      expect(await confirmation).toMatchObject({
        amount: 17,
        brandId: input.brandId,
      });
    });
    it("代理商跨企业并发划拨共同争用额度，重放不重复占用", async () => {
      const actorUserId = randomUUID();
      await db.insert(users).values({
        id: actorUserId,
        name: "Quota QA",
        email: `${actorUserId}@test.invalid`,
        accountType: "agent",
        agentAnswerbitPointsLimit: 25,
      });
      const first = await fixture(),
        second = await fixture();
      const results = await Promise.allSettled(
        [first, second].map((input) =>
          balanceService.allocate(input, actorUserId, audit(actorUserId)),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "AGENT_ANSWERBIT_POINTS_QUOTA_EXCEEDED" },
      });
      const [saved] = await db
        .select()
        .from(balanceTransactions)
        .where(eq(balanceTransactions.actorUserId, actorUserId));
      const original = [first, second].find(
        (input) => input.organizationId === saved.organizationId,
      )!;
      await db
        .update(users)
        .set({ agentAnswerbitPointsLimit: 0 })
        .where(eq(users.id, actorUserId));
      await expect(
        balanceService.allocate(original, actorUserId, audit(actorUserId)),
      ).resolves.toMatchObject({ replayed: true });
      expect(
        await db
          .select()
          .from(balanceTransactions)
          .where(eq(balanceTransactions.actorUserId, actorUserId)),
      ).toHaveLength(1);
    });
    it("余额不足不划拨，积分到期阻止积分但不阻止人民币", async () => {
      const input = await fixture();
      await expect(
        balanceService.allocate({ ...input, amount: 101 }, userId, audit()),
      ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
      expect((await state(input.organizationId)).transactions).toHaveLength(0);
      await db
        .update(organizations)
        .set({ pointsExpiresAt: new Date("2020-01-01") })
        .where(eq(organizations.id, input.organizationId));
      await expect(
        balanceService.allocate(input, userId, audit()),
      ).rejects.toThrow();
      await db.insert(balanceAccounts).values({
        organizationId: input.organizationId,
        asset: "publication_cny",
        balance: 100,
      });
      await expect(
        balanceService.allocate(
          { ...input, asset: "publication_cny" },
          userId,
          audit(),
        ),
      ).resolves.toMatchObject({ replayed: false });
      expect(
        await db
          .select()
          .from(balanceTransactions)
          .where(
            and(
              eq(balanceTransactions.organizationId, input.organizationId),
              eq(balanceTransactions.asset, "answerbit_points"),
            ),
          ),
      ).toHaveLength(0);
    });
  },
);
