import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "./client";
import {
  balanceAccounts,
  balanceTransactions,
  organizations,
  organizationMembers,
  memberRoles,
  roles,
  users,
} from "./schema";
import {
  listBalanceTransactions,
  listBalanceTransactionActors,
} from "./balances";
import { withTenantDbContext } from "./context";

describe.skipIf(process.env.TENANT_BALANCE_HISTORY_DB_TESTS !== "1")(
  "企业资产流水 PostgreSQL 回归",
  () => {
    const userId = randomUUID(),
      otherUser = randomUUID(),
      wildcardUser = randomUUID(),
      orgIds: string[] = [];
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Disposable QA database required");
      await db.insert(users).values(
        [userId, otherUser, wildcardUser].map((id) => ({
          id,
          name:
            id === wildcardUser ? "History %_ literal" : "Balance history QA",
          email: `${id}@test.invalid`,
          username: `ledger_${id.replaceAll("-", "").slice(0, 20)}`,
          status:
            id === otherUser ? ("disabled" as const) : ("active" as const),
        })),
      );
    });
    async function fixture() {
      const organizationId = randomUUID();
      orgIds.push(organizationId);
      await db.insert(organizations).values({
        id: organizationId,
        name: "Balance history QA",
        slug: organizationId,
      });
      const [membership] = await db
        .insert(organizationMembers)
        .values({ organizationId, userId, status: "active" })
        .returning();
      const [role] = await db
        .select()
        .from(roles)
        .where(eq(roles.code, "tenant_admin"));
      await db
        .insert(memberRoles)
        .values({ memberId: membership.id, roleId: role.id });
      const accounts = await db
        .insert(balanceAccounts)
        .values([
          { organizationId, asset: "answerbit_points", balance: 100 },
          {
            organizationId,
            asset: "answerbit_points",
            brandId: `brand-${organizationId}`,
            balance: 200,
          },
          {
            organizationId,
            asset: "publication_cny",
            brandId: `brand-${organizationId}`,
            balance: 300,
          },
        ])
        .returning();
      return { organizationId, accounts };
    }
    const ledger = (
      organizationId: string,
      input: Partial<typeof balanceTransactions.$inferInsert> = {},
    ) => ({
      id: randomUUID(),
      organizationId,
      asset: "answerbit_points" as const,
      operation: "grant" as const,
      amount: 1,
      referenceType: "manual_grant",
      referenceId: randomUUID(),
      idempotencyKey: randomUUID(),
      reason: "History QA",
      actorUserId: userId,
      createdAt: new Date("2026-01-01"),
      ...input,
    });
    const list = (organizationId: string, page = 1, pageSize = 100) =>
      listBalanceTransactions({ organizationId, page, pageSize }, userId);
    afterAll(async () => {
      if (orgIds.length) {
        await db
          .delete(balanceTransactions)
          .where(inArray(balanceTransactions.organizationId, orgIds));
        await db
          .delete(balanceAccounts)
          .where(inArray(balanceAccounts.organizationId, orgIds));
        await db
          .delete(organizationMembers)
          .where(inArray(organizationMembers.organizationId, orgIds));
        await db.delete(organizations).where(inArray(organizations.id, orgIds));
        await db
          .delete(users)
          .where(inArray(users.id, [userId, otherUser, wildcardUser]));
      }
      await pool.end();
    });
    it("相同时间按流水 ID 稳定分页，超界与空结果回退实际页", async () => {
      const { organizationId, accounts } = await fixture();
      const rows = Array.from({ length: 123 }, () =>
        ledger(organizationId, { targetAccountId: accounts[0].id }),
      );
      await db.insert(balanceTransactions).values(rows);
      const pages = await Promise.all(
        Array.from({ length: 7 }, (_, i) => list(organizationId, i + 1, 20)),
      );
      expect(pages.flatMap((p) => p.list.map((r) => r.id))).toEqual(
        rows
          .map((r) => r.id)
          .sort()
          .reverse(),
      );
      expect((await list(organizationId, 999, 20)).pagination).toEqual({
        page: 7,
        pageSize: 20,
        total: 123,
        pages: 7,
      });
      expect((await list(randomUUID(), 999, 10)).pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 0,
        pages: 0,
      });
    });
    it("资金池、品牌消费返还和品牌划拨分别返回真实来源与目标账户", async () => {
      const {
        organizationId,
        accounts: [fund, brand],
      } = await fixture();
      await db.insert(balanceTransactions).values([
        ledger(organizationId, {
          operation: "grant",
          targetAccountId: fund.id,
        }),
        ledger(organizationId, {
          operation: "allocate",
          sourceAccountId: fund.id,
          targetAccountId: brand.id,
        }),
        ledger(organizationId, {
          operation: "consume",
          sourceAccountId: brand.id,
        }),
        ledger(organizationId, {
          operation: "restore",
          targetAccountId: brand.id,
        }),
        ledger(organizationId, {
          operation: "adjust",
          referenceType: "admin_deduction",
          sourceAccountId: fund.id,
        }),
      ]);
      const rows = (await list(organizationId)).list;
      expect(rows.find((r) => r.operation === "allocate")).toMatchObject({
        sourceBrandId: null,
        targetBrandId: brand.brandId,
      });
      expect(rows.find((r) => r.operation === "consume")).toMatchObject({
        sourceBrandId: brand.brandId,
        targetBrandId: null,
      });
      expect(rows.find((r) => r.operation === "restore")).toMatchObject({
        sourceBrandId: null,
        targetBrandId: brand.brandId,
      });
      expect(rows.find((r) => r.operation === "grant")).toMatchObject({
        sourceBrandId: null,
        targetBrandId: null,
      });
    });
    it("企业、操作者、资产与类型条件取交集，不混入其他范围", async () => {
      const first = await fixture(),
        second = await fixture();
      await db.insert(balanceTransactions).values([
        ledger(first.organizationId, {
          actorUserId: otherUser,
          operation: "consume",
          asset: "publication_cny",
          sourceAccountId: first.accounts[2].id,
        }),
        ledger(first.organizationId, {
          operation: "consume",
          sourceAccountId: first.accounts[1].id,
        }),
        ledger(second.organizationId, {
          actorUserId: otherUser,
          operation: "consume",
          sourceAccountId: second.accounts[1].id,
        }),
      ]);
      const filtered = await listBalanceTransactions(
        {
          organizationId: first.organizationId,
          userId: otherUser,
          asset: "publication_cny",
          operation: "consume",
          page: 1,
          pageSize: 20,
        },
        userId,
      );
      expect(filtered.pagination.total).toBe(1);
      expect(filtered.list).toMatchObject([
        {
          organizationId: first.organizationId,
          actorUserId: otherUser,
          asset: "publication_cny",
        },
      ]);
    });
    it("北京时间闭合日期、用户、资产和操作取交集，旧流水也可查询", async () => {
      const { organizationId, accounts } = await fixture();
      const rows = [
        "2025-12-31T15:59:59.999Z",
        "2025-12-31T16:00:00Z",
        "2026-01-01T15:59:59.999Z",
        "2026-01-01T16:00:00Z",
      ].map((date) =>
        ledger(organizationId, {
          createdAt: new Date(date),
          actorUserId: otherUser,
          asset: "publication_cny",
          operation: "consume",
          sourceAccountId: accounts[2].id,
        }),
      );
      await db.insert(balanceTransactions).values([
        ...rows,
        ledger(organizationId, {
          actorUserId: userId,
          createdAt: rows[1].createdAt,
        }),
        ledger(organizationId, {
          actorUserId: otherUser,
          asset: "answerbit_points",
          createdAt: rows[1].createdAt,
        }),
      ]);
      const result = await listBalanceTransactions(
        {
          organizationId,
          userId: otherUser,
          asset: "publication_cny",
          operation: "consume",
          beginAt: new Date("2025-12-31T16:00:00Z"),
          endAtExclusive: new Date("2026-01-01T16:00:00Z"),
          page: 1,
          pageSize: 20,
        },
        userId,
      );
      expect(result.list.map((row) => row.id)).toEqual([
        rows[2].id,
        rows[1].id,
      ]);
      expect(result.pagination.total).toBe(2);
    });
    it("历史操作者不依赖当前成员或最近一页，搜索转义通配符且不暴露其他企业用户", async () => {
      const first = await fixture(),
        second = await fixture();
      await db.insert(balanceTransactions).values([
        ...Array.from({ length: 120 }, () =>
          ledger(first.organizationId, {
            actorUserId: userId,
            createdAt: new Date("2026-02-01"),
          }),
        ),
        ledger(first.organizationId, { actorUserId: otherUser }),
        ledger(first.organizationId, { actorUserId: wildcardUser }),
        ledger(second.organizationId, { actorUserId: userId }),
      ]);
      const actors = await listBalanceTransactionActors(
        { organizationId: first.organizationId },
        userId,
      );
      expect(actors.map((r) => r.id).sort()).toEqual(
        [userId, otherUser, wildcardUser].sort(),
      );
      expect(
        await listBalanceTransactionActors(
          { organizationId: first.organizationId, q: "%_" },
          userId,
        ),
      ).toMatchObject([{ id: wildcardUser }]);
      expect(
        await listBalanceTransactionActors(
          { organizationId: second.organizationId, userId: otherUser },
          userId,
        ),
      ).toEqual([]);
      expect(
        await listBalanceTransactionActors(
          {
            organizationId: first.organizationId,
            q: `ledger_${otherUser.replaceAll("-", "").slice(0, 20)}`,
          },
          userId,
        ),
      ).toMatchObject([{ id: otherUser }]);
    });
    it("历史用户投影只包含公开显示字段，非管理员和空上下文不能调用范围读取", async () => {
      const { organizationId } = await fixture();
      await db
        .insert(balanceTransactions)
        .values(ledger(organizationId, { actorUserId: otherUser }));
      const rows = await listBalanceTransactionActors(
        { organizationId },
        userId,
      );
      expect(Object.keys(rows[0]).sort()).toEqual(["id", "name", "username"]);
      expect((await list(organizationId)).list[0]).toMatchObject({
        actorName: "Balance history QA",
        actorUsername: `ledger_${otherUser.replaceAll("-", "").slice(0, 20)}`,
      });
      for (const context of [
        { organizationId, userId: otherUser },
        { organizationId: "", userId },
      ]) {
        const result = await withTenantDbContext(context, (tx) =>
          tx.execute(
            sql`select * from public.tenant_balance_actors(null, null)`,
          ),
        );
        expect(result.rows).toEqual([]);
      }
      const direct = await withTenantDbContext(
        { organizationId, userId },
        (tx) => tx.select().from(users).where(eq(users.id, otherUser)),
      );
      expect(direct).toEqual([]);
    });
    it("并发新增流水时同次响应的总数与明细保持同一快照", async () => {
      const { organizationId, accounts } = await fixture();
      const writes = Promise.all(
        Array.from({ length: 20 }, () =>
          db
            .insert(balanceTransactions)
            .values(
              ledger(organizationId, { targetAccountId: accounts[0].id }),
            ),
        ),
      );
      const reads = await Promise.all(
        Array.from({ length: 10 }, () => list(organizationId)),
      );
      await writes;
      for (const read of reads)
        expect(read.list).toHaveLength(read.pagination.total);
      expect((await list(organizationId)).pagination.total).toBe(20);
    });
  },
);
