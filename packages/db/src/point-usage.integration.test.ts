import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./client";
import { balanceAccounts, balanceTransactions, organizations } from "./schema";
import { getPointUsage } from "./balances";

describe.skipIf(process.env.POINT_USAGE_DB_TESTS !== "1")(
  "企业与品牌积分统计",
  () => {
    const org = randomUUID(),
      other = randomUUID();
    const input = {
      organizationId: org,
      beginAt: new Date("2026-09-01T00:00:00+08:00"),
      endAtExclusive: new Date("2026-09-02T00:00:00+08:00"),
      page: 1,
      pageSize: 20,
    };
    beforeAll(async () => {
      await db
        .insert(organizations)
        .values([org, other].map((id) => ({ id, name: "usage-qa", slug: id })));
      const accounts = await db
        .insert(balanceAccounts)
        .values([
          { organizationId: org, asset: "answerbit_points", balance: 100 },
          {
            organizationId: org,
            asset: "answerbit_points",
            brandId: "a",
            balance: 1_000_000_000,
          },
          {
            organizationId: org,
            asset: "answerbit_points",
            brandId: "b",
            balance: 1_000_000_000,
          },
          {
            organizationId: org,
            asset: "answerbit_points",
            brandId: "c",
            balance: 1_000_000_000,
          },
          {
            organizationId: org,
            asset: "publication_cny",
            brandId: "a",
            balance: 100,
          },
          {
            organizationId: other,
            asset: "answerbit_points",
            brandId: "a",
            balance: 999,
          },
        ])
        .returning();
      const [fund, a, b, c, cny, outsider] = accounts;
      const row = (
        account: typeof a,
        operation: "consume" | "restore" | "allocate" | "adjust",
        amount: number,
        time = "2026-09-01T12:00:00+08:00",
      ) => ({
        organizationId: account.organizationId,
        asset: account.asset,
        operation,
        amount,
        sourceAccountId: operation === "restore" ? null : account.id,
        targetAccountId: operation === "restore" ? account.id : null,
        referenceType: "usage-qa",
        referenceId: randomUUID(),
        reason: "usage-qa",
        idempotencyKey: randomUUID(),
        createdAt: new Date(time),
      });
      await db
        .insert(balanceTransactions)
        .values([
          row(a, "consume", 1_000_000_000, "2026-09-01T00:00:00+08:00"),
          row(b, "consume", 1_000_000_000),
          row(c, "consume", 1_000_000_000),
          row(a, "restore", 10, "2026-09-01T23:59:59.999+08:00"),
          row(a, "consume", 50, "2026-08-31T23:59:59.999+08:00"),
          row(a, "consume", 60, "2026-09-02T00:00:00+08:00"),
          { ...row(fund, "allocate", 100), targetAccountId: a.id },
          row(a, "adjust", 200),
          row(cny, "consume", 300),
          row(outsider, "consume", 400),
        ]);
    });
    afterAll(async () => {
      await db
        .delete(balanceTransactions)
        .where(inArray(balanceTransactions.organizationId, [org, other]));
      await db
        .delete(balanceAccounts)
        .where(inArray(balanceAccounts.organizationId, [org, other]));
      await db
        .delete(organizations)
        .where(inArray(organizations.id, [org, other]));
      await pool.end();
    });
    it("企业汇总不混入转账、纠错、人民币或其他企业，并支持超过 int32 的合计", async () => {
      const result = await getPointUsage(input);
      expect(result).toMatchObject({
        balance: 3_000_000_000,
        organizationBalance: 100,
        summary: { consumed: 3_000_000_000, restored: 10, transactionCount: 4 },
        pagination: { total: 4 },
      });
      expect(new Set(result.list.map((item) => item.brandId))).toEqual(
        new Set(["a", "b", "c"]),
      );
    });
    it("品牌范围与北京时间日期边界一致", async () => {
      const result = await getPointUsage({ ...input, brandId: "a" });
      expect(result).toMatchObject({
        balance: 1_000_000_000,
        summary: { consumed: 1_000_000_000, restored: 10, transactionCount: 2 },
        pagination: { total: 2 },
      });
      expect(result.list.every((item) => item.brandId === "a")).toBe(true);
    });
    it("类型筛选只过滤明细；分页稳定且不遗漏相同时间的记录", async () => {
      const first = await getPointUsage({
        ...input,
        operation: "consume",
        pageSize: 1,
      });
      const second = await getPointUsage({
        ...input,
        operation: "consume",
        pageSize: 1,
        page: 2,
      });
      expect(first.summary.restored).toBe(10);
      expect(first.pagination).toMatchObject({ total: 3, pages: 3 });
      expect(first.list[0].id).not.toBe(second.list[0].id);
      expect(
        (
          await getPointUsage({
            ...input,
            operation: "consume",
            pageSize: 1,
          })
        ).list[0].id,
      ).toBe(first.list[0].id);
    });
    it("超界页码返回实际末页；筛选为空时回到第一页", async () => {
      const last = await getPointUsage({
        ...input,
        operation: "consume",
        page: 100_000,
        pageSize: 1,
      });
      const third = await getPointUsage({
        ...input,
        operation: "consume",
        page: 3,
        pageSize: 1,
      });
      expect(last.pagination).toEqual({
        page: 3,
        pageSize: 1,
        total: 3,
        pages: 3,
      });
      expect(last.list).toHaveLength(1);
      expect(last.list[0].id).toBe(third.list[0].id);
      expect(last.summary).toMatchObject({
        consumed: 3_000_000_000,
        restored: 10,
      });
      const empty = await getPointUsage({
        ...input,
        brandId: "missing",
        page: 100_000,
      });
      expect(empty.pagination).toMatchObject({ page: 1, total: 0, pages: 0 });
      expect(empty.list).toEqual([]);
    });
    it("没有积分账户的企业或品牌返回空统计", async () => {
      expect(
        await getPointUsage({ ...input, brandId: "missing" }),
      ).toMatchObject({
        balance: 0,
        organizationBalance: 100,
        summary: { consumed: 0, restored: 0 },
        list: [],
      });
      const empty = randomUUID();
      await db
        .insert(organizations)
        .values({ id: empty, name: "empty-qa", slug: empty });
      try {
        expect(
          await getPointUsage({ ...input, organizationId: empty }),
        ).toMatchObject({
          balance: 0,
          organizationBalance: 0,
          list: [],
          pagination: { total: 0 },
        });
      } finally {
        await db.delete(organizations).where(eq(organizations.id, empty));
      }
    });
  },
);
