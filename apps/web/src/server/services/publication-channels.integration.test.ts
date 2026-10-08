import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db,
  users,
  publicationChannels,
  publicationChannelPriceOverrides,
  operationLogs,
} from "@geo/db";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), auditFailure: false }));
vi.mock("@/server/permissions/platform", () => ({
  requirePlatformPermission: mocks.permission,
}));
vi.mock("@/server/audit/write-audit", async (load) => {
  const actual = await load<typeof import("@/server/audit/write-audit")>();
  return {
    ...actual,
    writeAudit: (...args: Parameters<typeof actual.writeAudit>) => {
      if (mocks.auditFailure) throw new Error("audit unavailable");
      return actual.writeAudit(...args);
    },
  };
});
import { publicationService } from "./publications";

describe.skipIf(process.env.PUBLICATION_CHANNEL_DB_TESTS !== "1")(
  "渠道并发经营与只读核对 PostgreSQL 回归",
  () => {
    const userId = randomUUID();
    const inherited = { retail: null, bronze: null, silver: null, gold: null };
    const audit = () => ({ actorUserId: userId, requestId: randomUUID() });
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Publication channel QA requires disposable database");
      await db.insert(users).values({
        id: userId,
        name: "Publication channel QA",
        email: `${userId}@test.invalid`,
      });
    });
    beforeEach(() => {
      vi.clearAllMocks();
      mocks.permission.mockResolvedValue(undefined);
      mocks.auditFailure = false;
    });
    async function fixture(provider: "manual" | "frog_media" = "manual") {
      const [row] = await db
        .insert(publicationChannels)
        .values({
          id: randomUUID(),
          name: "原渠道名称",
          category: "原分类",
          priceAmount: 100,
          providerCostAmount: 100,
          provider,
          providerMediaType: provider === "manual" ? "manual" : "website",
          providerResourceId: provider === "manual" ? null : randomUUID(),
        })
        .returning();
      return row;
    }
    const logs = (id: string) =>
      db
        .select()
        .from(operationLogs)
        .where(
          and(
            eq(operationLogs.resourceId, id),
            eq(operationLogs.operation, "publication.channel.update"),
          ),
        );
    const read = (id: string) => publicationService.adminChannel(id, userId);
    const update = (
      id: string,
      input: Parameters<typeof publicationService.updateChannel>[1],
    ) => publicationService.updateChannel(id, input, userId, audit());

    it("单字段上下架保留基础价与固定价，单笔核对使用同形快照且不写审计", async () => {
      const row = await fixture();
      await db.insert(publicationChannelPriceOverrides).values({
        channelId: row.id,
        tier: "retail",
        priceAmount: 180,
      });
      const before = await read(row.id);
      expect(before).toMatchObject({
        basePriceAmount: 100,
        priceAmount: 180,
        tierPrices: {
          retail: { priceAmount: 180, overridden: true },
          bronze: { priceAmount: 100, overridden: false },
        },
      });
      const saved = await update(row.id, {
        status: "inactive",
        expected: { status: "active" },
      });
      expect(saved).toMatchObject({
        name: row.name,
        category: row.category,
        basePriceAmount: 100,
        priceAmount: 180,
        status: "inactive",
        tierPrices: before.tierPrices,
      });
      expect(await read(row.id)).toEqual(saved);
      expect(await logs(row.id)).toHaveLength(1);
      expect(mocks.permission).toHaveBeenCalledWith(
        userId,
        "platform.publication.manage",
      );
    });

    it("并发同目标和响应丢失后的旧原值重放只写一次审计", async () => {
      const row = await fixture();
      const input = {
        status: "inactive" as const,
        expected: { status: "active" as const },
      };
      const [first, second] = await Promise.all([
        update(row.id, input),
        update(row.id, input),
      ]);
      expect(first).toEqual(second);
      expect(await update(row.id, input)).toEqual(first);
      expect(await logs(row.id)).toHaveLength(1);
    });

    it("并发不同价格只有一个成功，冲突返回最新同形快照且不覆盖", async () => {
      const row = await fixture();
      const results = await Promise.allSettled(
        [150, 160].map((price) =>
          update(row.id, {
            tierPrices: { ...inherited, retail: price },
            expected: { tierPrices: inherited },
          }),
        ),
      );
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const failed = results.find((result) => result.status === "rejected");
      expect(failed?.status).toBe("rejected");
      if (failed?.status !== "rejected") throw new Error("Expected conflict");
      const current = await read(row.id);
      expect(failed.reason).toMatchObject({
        status: 409,
        code: "PUBLICATION_CHANNEL_CONFLICT",
        details: { current },
      });
      expect(current.basePriceAmount).toBe(100);
      expect(await logs(row.id)).toHaveLength(1);
    });

    it("不同字段并发修改分别保留，不要求未改字段原值", async () => {
      const row = await fixture();
      await Promise.all([
        update(row.id, { name: "新渠道名称", expected: { name: row.name } }),
        update(row.id, { status: "inactive", expected: { status: "active" } }),
      ]);
      expect(await read(row.id)).toMatchObject({
        name: "新渠道名称",
        status: "inactive",
      });
      expect(await logs(row.id)).toHaveLength(2);
    });

    it("审计失败回滚渠道、固定价与更新时间", async () => {
      const row = await fixture();
      const before = await read(row.id);
      mocks.auditFailure = true;
      await expect(
        update(row.id, {
          priceAmount: 200,
          status: "inactive",
          tierPrices: { ...inherited, retail: 250 },
          expected: {
            priceAmount: 100,
            status: "active",
            tierPrices: inherited,
          },
        }),
      ).rejects.toThrow("audit unavailable");
      expect(await read(row.id)).toEqual(before);
      expect(await logs(row.id)).toHaveLength(0);
    });

    it("采购成本并发同步完成后，在行锁内按最新成本拒绝低价", async () => {
      const row = await fixture("frog_media");
      let release!: () => void;
      let locked!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const providerSync = db.transaction(async (tx) => {
        await tx
          .update(publicationChannels)
          .set({
            providerCostAmount: 200,
            priceAmount: 200,
            name: "上游新名称",
          })
          .where(eq(publicationChannels.id, row.id));
        locked();
        await hold;
      });
      await ready;
      const pending = update(row.id, {
        tierPrices: { ...inherited, retail: 150 },
        expected: { tierPrices: inherited },
      });
      release();
      await providerSync;
      await expect(pending).rejects.toMatchObject({
        status: 422,
        code: "PUBLICATION_PRICE_BELOW_COST",
        details: { current: { providerCostAmount: 200, name: "上游新名称" } },
      });
      expect((await read(row.id)).tierPrices.retail.overridden).toBe(false);
      expect(await logs(row.id)).toHaveLength(0);
    });

    it("兼容旧完整 PATCH，清除固定价后恢复人工基础价", async () => {
      const row = await fixture();
      const saved = await update(row.id, {
        name: row.name,
        category: row.category,
        priceAmount: 120,
        status: "active",
        tierPrices: { ...inherited, retail: 150 },
      });
      expect(saved).toMatchObject({
        basePriceAmount: 120,
        priceAmount: 150,
        providerCostAmount: 120,
      });
      const cleared = await update(row.id, {
        tierPrices: inherited,
        expected: { tierPrices: { ...inherited, retail: 150 } },
      });
      expect(cleared).toMatchObject({ basePriceAmount: 120, priceAmount: 120 });
      expect(cleared.tierPrices.retail.overridden).toBe(false);
    });

    it("单笔读取和修改都先验证平台权限，未知渠道返回 404", async () => {
      const failure = new Error("platform permission denied");
      mocks.permission.mockRejectedValue(failure);
      await expect(read(randomUUID())).rejects.toBe(failure);
      await expect(update(randomUUID(), { status: "inactive" })).rejects.toBe(
        failure,
      );
      mocks.permission.mockResolvedValue(undefined);
      await expect(read(randomUUID())).rejects.toMatchObject({
        code: "PUBLICATION_CHANNEL_NOT_FOUND",
        status: 404,
      });
      await expect(
        update(randomUUID(), { status: "inactive" }),
      ).rejects.toMatchObject({
        code: "PUBLICATION_CHANNEL_NOT_FOUND",
        status: 404,
      });
    });
  },
);
