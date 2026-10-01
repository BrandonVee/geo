import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  organizations,
  users,
  answerbitConnections,
  answerbitTeamBindings,
  answerbitBrandMappings,
  organizationMembers,
  pool,
  balanceAccounts,
} from "@geo/db";
import { adminRepository } from "./admin";
import { balanceRepository } from "./balances";

describe.skipIf(process.env.ORGANIZATION_DIRECTORY_DB_TESTS !== "1")(
  "企业目录 PostgreSQL 回归",
  () => {
    const userId = randomUUID(),
      secondUser = randomUUID();
    const orgIds: string[] = [],
      connectionIds: string[] = [];
    const prefix = `dir-${randomUUID().slice(0, 8)}`;
    const past = new Date("2020-01-01T00:00:00Z"),
      future = new Date("2038-01-01T00:00:00Z");
    let cleanupAllowed = false;
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Disposable workflow QA database required");
      cleanupAllowed = true;
      await db.insert(users).values(
        [userId, secondUser].map((id) => ({
          id,
          name: "Directory QA",
          email: `${id}@test.invalid`,
        })),
      );
    });
    async function create(
      name: string,
      settings: {
        status?: "active" | "suspended" | "closed";
        serviceExpiresAt?: Date | null;
        pointsExpiresAt?: Date | null;
        brandId?: string;
        brandName?: string;
        mapped?: boolean;
        createdAt?: Date;
      } = {},
    ) {
      const id = randomUUID(),
        slug = `${prefix}-${randomUUID()}`;
      orgIds.push(id);
      const [row] = await db
        .insert(organizations)
        .values({
          id,
          name,
          slug,
          status: settings.status ?? "active",
          serviceExpiresAt:
            settings.serviceExpiresAt === undefined
              ? future
              : settings.serviceExpiresAt,
          pointsExpiresAt:
            settings.pointsExpiresAt === undefined
              ? future
              : settings.pointsExpiresAt,
          createdAt: settings.createdAt ?? new Date(),
        })
        .returning();
      if (settings.mapped === false) return { ...row, brandId: "" };
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId: id,
          encryptedApiKey: "qa-unused",
          apiKeyFingerprint: randomUUID(),
          apiKeyHint: "qa",
          createdBy: userId,
          managedByPlatform: true,
        })
        .returning();
      connectionIds.push(connection.id);
      const [binding] = await db
        .insert(answerbitTeamBindings)
        .values({
          organizationId: id,
          connectionId: connection.id,
          teamId: "qa-team",
          status: "active",
        })
        .returning();
      const brandId = settings.brandId ?? `${prefix}-${randomUUID()}`;
      await db.insert(answerbitBrandMappings).values({
        organizationId: id,
        teamBindingId: binding.id,
        brandId,
        brandName: settings.brandName ?? name,
      });
      return { ...row, brandId };
    }
    const list = (
      q: string,
      extra: {
        page?: number;
        pageSize?: number;
        status?: "active" | "suspended";
        accessState?: "active" | "suspended" | "expired";
      } = {},
    ) =>
      adminRepository.listOrganizations(
        { page: 1, pageSize: 100, q, ...extra },
        userId,
      );
    afterAll(async () => {
      if (cleanupAllowed && orgIds.length) {
        await db
          .delete(balanceAccounts)
          .where(inArray(balanceAccounts.organizationId, orgIds));
        await db
          .delete(organizationMembers)
          .where(inArray(organizationMembers.organizationId, orgIds));
        await db
          .delete(answerbitBrandMappings)
          .where(inArray(answerbitBrandMappings.organizationId, orgIds));
        await db
          .delete(answerbitTeamBindings)
          .where(inArray(answerbitTeamBindings.organizationId, orgIds));
        await db
          .delete(answerbitConnections)
          .where(inArray(answerbitConnections.id, connectionIds));
        await db.delete(organizations).where(inArray(organizations.id, orgIds));
        await db.delete(users).where(inArray(users.id, [userId, secondUser]));
      }
      await pool.end();
    });
    it("名称、品牌名称、BrandID、企业 UUID 与内部标识均可搜索，文字通配符按原文匹配", async () => {
      const row = await create(`${prefix}-企业100%_\\标识`, {
        brandId: `${prefix}-brand-100%_\\code`,
        brandName: `${prefix}-上游品牌`,
      });
      await create(`${prefix}-企业100XY标识`, {
        brandId: `${prefix}-brand-100XYcode`,
      });
      for (const q of [
        row.name,
        row.brandId,
        row.id,
        row.slug,
        `${prefix}-上游品牌`,
      ]) {
        const result = await list(q);
        expect(result.list.map((item) => item.id)).toEqual([row.id]);
        expect(result.pagination.total).toBe(1);
      }
    });
    it("同一接入时间按企业 ID 稳定分页，超界页码返回实际末页", async () => {
      const marker = `${prefix}-page`;
      const ids: string[] = [];
      for (let index = 0; index < 23; index++)
        ids.push((await create(`${marker}-${index}`, { createdAt: past })).id);
      const pages = await Promise.all(
        [1, 2, 3].map((page) => list(marker, { page, pageSize: 10 })),
      );
      expect(pages.flatMap((page) => page.list.map((row) => row.id))).toEqual(
        ids.sort().reverse(),
      );
      expect(
        new Set(pages.flatMap((page) => page.list.map((row) => row.id))).size,
      ).toBe(23);
      const last = await list(marker, { page: 999, pageSize: 10 });
      expect(last.pagination).toEqual({
        page: 3,
        pageSize: 10,
        total: 23,
        pages: 3,
      });
      expect(last.list.map((row) => row.id)).toEqual(
        pages[2].list.map((row) => row.id),
      );
    });
    it("服务正常排除到期企业，手动冻结优先，积分过期与服务状态独立，原始状态筛选保持原义", async () => {
      const marker = `${prefix}-state`;
      const legacy = await create(marker, {
        serviceExpiresAt: null,
        pointsExpiresAt: null,
      });
      const active = await create(marker);
      const points = await create(marker, { pointsExpiresAt: past });
      const expired = await create(marker, { serviceExpiresAt: past });
      const suspended = await create(marker, { status: "suspended" });
      const both = await create(marker, {
        status: "suspended",
        serviceExpiresAt: past,
      });
      expect(
        (await list(marker, { accessState: "active" })).list
          .map((row) => row.id)
          .sort(),
      ).toEqual([legacy.id, active.id, points.id].sort());
      expect(
        (await list(marker, { accessState: "suspended" })).list
          .map((row) => row.id)
          .sort(),
      ).toEqual([suspended.id, both.id].sort());
      expect(
        (await list(marker, { accessState: "expired" })).list,
      ).toMatchObject([
        {
          id: expired.id,
          status: "active",
          accessState: "expired",
          pointsExpired: false,
        },
      ]);
      expect((await list(marker, { status: "active" })).pagination.total).toBe(
        4,
      );
      const visible = (await list(marker)).list;
      expect(visible.find((row) => row.id === points.id)).toMatchObject({
        accessState: "active",
        pointsExpired: true,
      });
      expect(visible.find((row) => row.id === legacy.id)).toMatchObject({
        accessState: "active",
        pointsExpired: false,
      });
    });
    it("冻结筛选末页的最后一家企业后回退有效页，空结果页码为 1", async () => {
      const marker = `${prefix}-shrink`;
      for (let index = 0; index < 11; index++)
        await create(`${marker}-${index}`);
      const last = await list(marker, {
        page: 2,
        pageSize: 10,
        accessState: "active",
      });
      expect(last.list).toHaveLength(1);
      await db
        .update(organizations)
        .set({ status: "suspended" })
        .where(eq(organizations.id, last.list[0].id));
      const shrunk = await list(marker, {
        page: 2,
        pageSize: 10,
        accessState: "active",
      });
      expect(shrunk.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 10,
        pages: 1,
      });
      expect(shrunk.list).toHaveLength(10);
      expect(
        (await list(`${prefix}-missing`, { page: 999 })).pagination,
      ).toMatchObject({ page: 1, total: 0, pages: 0 });
    });
    it("关闭或未映射企业不进入目录，成员关系不重复计数企业", async () => {
      const marker = `${prefix}-visibility`;
      const row = await create(marker);
      await create(marker, { status: "closed" });
      await create(marker, { mapped: false });
      await db.insert(organizationMembers).values(
        [userId, secondUser].map((id) => ({
          organizationId: row.id,
          userId: id,
          status: "active" as const,
        })),
      );
      const result = await list(marker);
      expect(result.pagination.total).toBe(1);
      expect(result.list).toMatchObject([{ id: row.id, memberCount: 2 }]);
    });
    it("企业资产分别返回资金池与当前映射品牌的双余额，旧品牌账户不混入，普通企业集合不返回财务字段", async () => {
      const row = await create(`${prefix}-funds`, {
        status: "suspended",
        pointsExpiresAt: past,
      });
      const other = await create(`${prefix}-other-funds`);
      await db.insert(balanceAccounts).values([
        { organizationId: row.id, asset: "answerbit_points", balance: 117 },
        { organizationId: row.id, asset: "publication_cny", balance: 299 },
        {
          organizationId: row.id,
          brandId: row.brandId,
          asset: "answerbit_points",
          balance: 700,
        },
        {
          organizationId: row.id,
          brandId: row.brandId,
          asset: "publication_cny",
          balance: 502,
        },
        {
          organizationId: row.id,
          brandId: "old-unmapped-brand",
          asset: "answerbit_points",
          balance: 9999,
        },
        { organizationId: other.id, asset: "answerbit_points", balance: 999 },
      ]);
      const result = await balanceRepository.organizationBalances(
        { page: 1, pageSize: 20, q: row.id },
        userId,
      );
      expect(result.list).toMatchObject([
        {
          id: row.id,
          accessState: "suspended",
          pointsExpired: true,
          balances: {
            enterprisePoints: 117,
            enterprisePublicationCny: 299,
            brandPoints: 700,
            brandPublicationCny: 502,
          },
        },
      ]);
      expect((await list(row.id)).list[0]).not.toHaveProperty("balances");
      expect(
        (
          await balanceRepository.organizationBalances(
            { page: 1, pageSize: 20, q: other.id },
            userId,
          )
        ).list,
      ).toMatchObject([
        {
          balances: {
            enterprisePoints: 999,
            enterprisePublicationCny: 0,
            brandPoints: 0,
            brandPublicationCny: 0,
          },
        },
      ]);
    });
    it("超过 100 家企业仍可分页、按 BrandID 定位并显示零账户，目录缩小回退有效末页", async () => {
      const marker = `${prefix}-large-funds`,
        rows = [];
      for (let i = 0; i < 105; i++)
        rows.push(await create(`${marker}-${i}`, { createdAt: past }));
      const last = await balanceRepository.organizationBalances(
        { page: 2, pageSize: 100, q: marker },
        userId,
      );
      expect(last.pagination).toMatchObject({ page: 2, total: 105 });
      expect(last.list).toHaveLength(5);
      const target = last.list[0],
        original = rows.find((r) => r.id === target.id)!;
      expect(
        (
          await balanceRepository.organizationBalances(
            { page: 1, pageSize: 20, q: original.brandId },
            userId,
          )
        ).list,
      ).toMatchObject([
        {
          id: target.id,
          balances: {
            enterprisePoints: 0,
            enterprisePublicationCny: 0,
            brandPoints: 0,
            brandPublicationCny: 0,
          },
        },
      ]);
      await db
        .update(organizations)
        .set({ status: "closed" })
        .where(
          inArray(
            organizations.id,
            last.list.map((r) => r.id),
          ),
        );
      expect(
        (
          await balanceRepository.organizationBalances(
            { page: 999, pageSize: 100, q: marker },
            userId,
          )
        ).pagination,
      ).toMatchObject({ page: 1, total: 100, pages: 1 });
    }, 20_000);
  },
);
