import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./client";
import { withTenantDbContext } from "./context";
import {
  organizations,
  users,
  publicationOrders,
  publicationChannels,
} from "./schema";
import { listPublicationOrdersPage } from "./publications";

describe.skipIf(process.env.ORDER_HISTORY_DB_TESTS !== "1")(
  "发布订单分页 PostgreSQL 回归",
  () => {
    const org = randomUUID(),
      other = randomUUID(),
      user = randomUUID(),
      channel = randomUUID();
    const batch = Array.from({ length: 30 }, () => randomUUID())
      .sort()
      .reverse();
    let cleanupAllowed = false;
    const input = {
      organizationId: org,
      brandId: "brand-a",
      userId: user,
      page: 1,
      pageSize: 10,
      keyword: "",
    };
    const row = (
      id: string,
      title: string,
      createdAt = new Date("2026-09-15T00:00:00Z"),
    ) => ({
      id,
      organizationId: org,
      brandId: "brand-a",
      channelId: channel,
      createdBy: user,
      idempotencyKey: id,
      priceAmount: 100,
      title,
      status: "processing" as const,
      createdAt,
    });
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error(
          "Order history QA requires disposable workflow database",
        );
      cleanupAllowed = true;
      await db.insert(users).values({
        id: user,
        name: "order-history-qa",
        email: `${user}@test.invalid`,
      });
      await db.insert(organizations).values(
        [org, other].map((id) => ({
          id,
          name: "order-history-qa",
          slug: id,
        })),
      );
      await db.insert(publicationChannels).values({
        id: channel,
        name: "订单查询媒体",
        category: "测试",
        priceAmount: 100,
      });
      await db
        .insert(publicationOrders)
        .values([
          ...batch.map((id) => row(id, "批次文章")),
          row(randomUUID(), "100%_文章"),
          row(randomUUID(), "100XY文章"),
          { ...row(randomUUID(), "其他品牌文章"), brandId: "brand-b" },
          { ...row(randomUUID(), "其他企业文章"), organizationId: other },
          ...[
            "2026-08-31T15:59:59Z",
            "2026-08-31T16:00:00Z",
            "2026-09-01T15:59:59Z",
            "2026-09-01T16:00:00Z",
          ].map((date) => row(randomUUID(), "北京时间界限", new Date(date))),
        ]);
    });
    afterAll(async () => {
      if (!cleanupAllowed) {
        await pool.end();
        return;
      }
      await db
        .delete(publicationOrders)
        .where(inArray(publicationOrders.organizationId, [org, other]));
      await db
        .delete(publicationChannels)
        .where(eq(publicationChannels.id, channel));
      await db
        .delete(organizations)
        .where(inArray(organizations.id, [org, other]));
      await db.delete(users).where(eq(users.id, user));
      await pool.end();
    });
    it("相同时间的三页记录稳定且不重复，不混入其他范围", async () => {
      const pages = await Promise.all(
        [1, 2, 3].map((page) =>
          listPublicationOrdersPage({ ...input, page, keyword: "批次" }),
        ),
      );
      expect(
        pages.flatMap((page) => page.list.map(({ order }) => order.id)),
      ).toEqual(batch);
      for (const page of pages)
        expect(page.pagination).toMatchObject({
          total: 30,
          pages: 3,
          pageSize: 10,
        });
    });
    it("百分号和下划线按用户输入的文字匹配", async () => {
      const result = await listPublicationOrdersPage({
        ...input,
        keyword: "%_",
      });
      expect(result.list.map(({ order }) => order.title)).toEqual([
        "100%_文章",
      ]);
      expect(result.pagination.total).toBe(1);
    });
    it("可按媒体名称和订单编号找到历史", async () => {
      const media = await listPublicationOrdersPage({
        ...input,
        keyword: "订单查询媒体",
        pageSize: 100,
      });
      expect(media.pagination.total).toBe(36);
      const exact = await listPublicationOrdersPage({
        ...input,
        keyword: batch[0],
      });
      expect(exact.list.map(({ order }) => order.id)).toEqual([batch[0]]);
    });
    it("日期按北京时间包含首日零点与末日最后一秒", async () => {
      const result = await listPublicationOrdersPage({
        ...input,
        keyword: "北京时间界限",
        beginDate: "2026-09-01",
        endDate: "2026-09-01",
      });
      expect(
        result.list.map(({ order }) => order.createdAt.toISOString()),
      ).toEqual(["2026-09-01T15:59:59.000Z", "2026-08-31T16:00:00.000Z"]);
    });
    it("企业级查询包含本企业品牌，租户 RLS 拒绝其他企业", async () => {
      const result = await listPublicationOrdersPage({
        ...input,
        brandId: undefined,
        pageSize: 100,
      });
      expect(result.pagination.total).toBe(37);
      expect(
        result.list.every(({ order }) => order.organizationId === org),
      ).toBe(true);
      const forbidden = await withTenantDbContext(input, (tx) =>
        tx
          .select()
          .from(publicationOrders)
          .where(eq(publicationOrders.organizationId, other)),
      );
      expect(forbidden).toEqual([]);
    });
    it("页码超出范围回到实际末页，记录消失后回到第一页", async () => {
      const result = await listPublicationOrdersPage({
        ...input,
        keyword: batch[0],
        page: 99,
      });
      expect(result.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 1,
        pages: 1,
      });
      await db
        .update(publicationOrders)
        .set({ status: "failed" })
        .where(eq(publicationOrders.id, batch[0]));
      const empty = await listPublicationOrdersPage({
        ...input,
        keyword: batch[0],
        status: "processing",
        page: 99,
      });
      expect(empty.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 0,
        pages: 0,
      });
      expect(empty.list).toEqual([]);
    });
  },
);
