import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./client";
import {
  balanceAccounts,
  balanceTransactions,
  organizations,
  users,
} from "./schema";
import { listAllBalanceTransactions } from "./balances";

describe.skipIf(process.env.ADMIN_BALANCE_HISTORY_DB_TESTS !== "1")(
  "平台资产流水 PostgreSQL 回归",
  () => {
    const userId = randomUUID(),
      otherUser = randomUUID(),
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
        [userId, otherUser].map((id) => ({
          id,
          name: "Balance history QA",
          email: `${id}@test.invalid`,
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
      listAllBalanceTransactions({ organizationId, page, pageSize }, userId);
    afterAll(async () => {
      if (orgIds.length) {
        await db
          .delete(balanceTransactions)
          .where(inArray(balanceTransactions.organizationId, orgIds));
        await db
          .delete(balanceAccounts)
          .where(inArray(balanceAccounts.organizationId, orgIds));
        await db.delete(organizations).where(inArray(organizations.id, orgIds));
        await db.delete(users).where(inArray(users.id, [userId, otherUser]));
      }
      await pool.end();
    });
    it("相同时间按流水 ID 稳定分页，超界与空结果回退实际页", async () => {
      const { organizationId, accounts } = await fixture();
      const rows = Array.from({ length: 23 }, () =>
        ledger(organizationId, { targetAccountId: accounts[0].id }),
      );
      await db.insert(balanceTransactions).values(rows);
      const pages = await Promise.all(
        [1, 2, 3].map((p) => list(organizationId, p, 10)),
      );
      expect(pages.flatMap((p) => p.list.map((r) => r.id))).toEqual(
        rows
          .map((r) => r.id)
          .sort()
          .reverse(),
      );
      expect((await list(organizationId, 999, 10)).pagination).toEqual({
        page: 3,
        pageSize: 10,
        total: 23,
        pages: 3,
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
      const filtered = await listAllBalanceTransactions(
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
    it("关闭企业保留历史流水，删除末页记录后回退有效页", async () => {
      const { organizationId } = await fixture();
      const rows = Array.from({ length: 11 }, () => ledger(organizationId));
      await db.insert(balanceTransactions).values(rows);
      await db
        .update(organizations)
        .set({ status: "closed" })
        .where(eq(organizations.id, organizationId));
      const last = await list(organizationId, 2, 10);
      expect(last.list).toHaveLength(1);
      await db
        .delete(balanceTransactions)
        .where(eq(balanceTransactions.id, last.list[0].id));
      expect((await list(organizationId, 2, 10)).pagination).toMatchObject({
        page: 1,
        total: 10,
      });
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
