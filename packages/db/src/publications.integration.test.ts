import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "./client";
import {
  users,
  organizations,
  publicationChannels,
  publicationOrders,
  balanceAccounts,
  balanceTransactions,
} from "./schema";
import {
  createPublicationOrderWithBalance,
  updatePublicationOrder,
  recordPublicationProviderSnapshot,
} from "./publications";

// Explicit opt-in: fixtures are new UUID-scoped rows, never existing business records.
describe.skipIf(process.env.PUBLICATION_DB_TESTS !== "1")(
  "发布事务 PostgreSQL 回归",
  () => {
    const org = randomUUID(),
      user = randomUUID(),
      channel = randomUUID(),
      free = randomUUID();
    const input = {
      organizationId: org,
      brandId: "fixture-brand",
      channelId: channel,
      title: "回归测试",
      note: "",
      idempotencyKey: randomUUID(),
      createdBy: user,
    };
    beforeAll(async () => {
      await db.insert(users).values({
        id: user,
        name: "Publication test",
        email: `${user}@test.invalid`,
      });
      await db
        .insert(organizations)
        .values({ id: org, name: "Publication test", slug: org });
      await db.insert(publicationChannels).values([
        {
          id: channel,
          name: "Paid fixture",
          category: "test",
          priceAmount: 100,
        },
        { id: free, name: "Free fixture", category: "test", priceAmount: 0 },
      ]);
      await db.insert(balanceAccounts).values({
        organizationId: org,
        brandId: input.brandId,
        asset: "publication_cny",
        balance: 1000,
      });
    });
    afterAll(async () => {
      await db
        .delete(balanceTransactions)
        .where(eq(balanceTransactions.organizationId, org));
      await db
        .delete(publicationOrders)
        .where(eq(publicationOrders.organizationId, org));
      await db
        .delete(balanceAccounts)
        .where(eq(balanceAccounts.organizationId, org));
      await db
        .delete(publicationChannels)
        .where(sql`${publicationChannels.id} in (${channel}, ${free})`);
      await db.delete(organizations).where(eq(organizations.id, org));
      await db.delete(users).where(eq(users.id, user));
      await pool.end();
    });
    it("并发同键下单只创建并扣款一次，取消并发仅返还一次", async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          createPublicationOrderWithBalance(input),
        ),
      );
      expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
      const result = results[0];
      if (!result.ok) throw new Error("create failed");
      const [before] = await db
        .select()
        .from(balanceAccounts)
        .where(eq(balanceAccounts.organizationId, org));
      expect(before.balance).toBe(900);
      await Promise.all(
        Array.from({ length: 8 }, () =>
          updatePublicationOrder({
            orderId: result.order.id,
            status: "cancelled",
            processedBy: user,
          }),
        ),
      );
      const [after] = await db
        .select()
        .from(balanceAccounts)
        .where(eq(balanceAccounts.organizationId, org));
      expect(after.balance).toBe(1000);
      const ledger = await db
        .select()
        .from(balanceTransactions)
        .where(eq(balanceTransactions.organizationId, org));
      expect(ledger).toHaveLength(2);
      expect(
        await createPublicationOrderWithBalance({ ...input, brandId: "other" }),
      ).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    });
    it("零元渠道可以下单与取消，不创建零金额流水", async () => {
      const result = await createPublicationOrderWithBalance({
        ...input,
        channelId: free,
        idempotencyKey: randomUUID(),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(
        await updatePublicationOrder({
          orderId: result.order.id,
          status: "cancelled",
          processedBy: user,
        }),
      ).toMatchObject({ status: "cancelled" });
      expect(
        await db
          .select()
          .from(balanceTransactions)
          .where(eq(balanceTransactions.referenceId, result.order.id)),
      ).toHaveLength(0);
    });
    it("支持数据库微秒时间戳，且同一版本仅允许一次快照更新", async () => {
      const result = await createPublicationOrderWithBalance({
        ...input,
        channelId: free,
        idempotencyKey: randomUUID(),
      });
      if (!result.ok) throw new Error("create failed");
      const [original] = await db
        .update(publicationOrders)
        .set({ updatedAt: sql`'2026-01-01T00:00:00.123456Z'::timestamptz` })
        .where(eq(publicationOrders.id, result.order.id))
        .returning();
      const snapshot = {
        orderId: original.id,
        expectedUpdatedAt: original.updatedAt,
        providerStatus: 1,
      };
      expect(await recordPublicationProviderSnapshot(snapshot)).toMatchObject({
        providerStatus: 1,
      });
      expect(
        await recordPublicationProviderSnapshot({
          ...snapshot,
          providerStatus: 2,
        }),
      ).toBeUndefined();
      const [latest] = await db
        .select()
        .from(publicationOrders)
        .where(eq(publicationOrders.id, original.id));
      expect(
        await updatePublicationOrder({
          orderId: original.id,
          expectedUpdatedAt: latest.updatedAt,
          status: "published",
          resultUrl: "https://example.com/done",
          processedBy: null,
          providerSync: true,
        }),
      ).toMatchObject({ status: "published" });
    });
    it("迟到的上游状态不覆盖本地取消", async () => {
      const result = await createPublicationOrderWithBalance({
        ...input,
        channelId: free,
        idempotencyKey: randomUUID(),
      });
      if (!result.ok) throw new Error("create failed");
      await updatePublicationOrder({
        orderId: result.order.id,
        status: "cancelled",
        processedBy: user,
      });
      expect(
        await recordPublicationProviderSnapshot({
          orderId: result.order.id,
          expectedUpdatedAt: result.order.updatedAt,
          providerStatus: 2,
          resultUrl: "https://example.com/late",
        }),
      ).toBeUndefined();
    });
  },
);
