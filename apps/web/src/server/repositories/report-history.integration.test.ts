import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  pool,
  users,
  organizations,
  answerbitConnections,
  answerbitTeamBindings,
  reportExports,
} from "@geo/db";
import { reportExportListQuerySchema } from "@geo/contracts";
import { reportExportRepository as repository } from "./report-exports";

describe.skipIf(process.env.REPORT_HISTORY_DB_TESTS !== "1")(
  "报告历史查询 PostgreSQL 回归",
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
          name: "Report History QA",
          email: `${id}@test.invalid`,
        })),
      );
    });
    afterAll(async () => {
      await pool.end();
    });
    async function fixture() {
      const organizationId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "Report History QA",
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
          teamId: randomUUID(),
        })
        .returning();
      return {
        organizationId,
        teamBindingId: binding.id,
        brandId: randomUUID(),
      };
    }
    const read = (
      scope: Awaited<ReturnType<typeof fixture>>,
      patch: Record<string, unknown> = {},
    ) =>
      repository.page(
        reportExportListQuerySchema.parse({ ...scope, ...patch }),
        userId,
      );
    async function seed(
      scope: Awaited<ReturnType<typeof fixture>>,
      count = 123,
    ) {
      return db
        .insert(reportExports)
        .values(
          Array.from({ length: count }, (_, i) => ({
            ...scope,
            requestedBy: i % 2 ? userId : otherUserId,
            reportType: "answers" as const,
            filters: {
              beginDate: "2026-08-01",
              endDate: "2026-08-31",
              keyword: `问题 ${i}`,
            },
            idempotencyKey: randomUUID(),
            filename: `报告 ${i}.csv`,
            status: "failed" as const,
            fileContent: "PRIVATE_CSV_DO_NOT_RETURN",
            createdAt: new Date("2026-09-01T16:00:00Z"),
          })),
        )
        .returning();
    }
    it("完整历史稳定分页，同品牌其他操作者可见，元数据不含CSV正文", async () => {
      const scope = await fixture();
      const rows = await seed(scope);
      const seen: string[] = [];
      for (let page = 1; page <= 7; page++) {
        const result = await read(scope, { page });
        expect(result.pagination.total).toBe(123);
        seen.push(...result.list.map((row) => row.id));
        expect(JSON.stringify(result)).not.toContain(
          "PRIVATE_CSV_DO_NOT_RETURN",
        );
        expect(result.list.every((row) => !("fileContent" in row))).toBe(true);
      }
      expect(seen).toEqual(
        rows
          .map((row) => row.id)
          .sort()
          .reverse(),
      );
      expect((await read(scope, { page: 999 })).pagination).toMatchObject({
        page: 7,
        total: 123,
      });
    });
    it("企业、内部绑定和品牌隔离，空历史回到第一页", async () => {
      const first = await fixture(),
        second = await fixture();
      await seed(first, 3);
      await seed(second, 4);
      expect((await read(first)).pagination.total).toBe(3);
      expect(
        await read({ ...first, brandId: second.brandId }, { page: 4 }),
      ).toMatchObject({ list: [], pagination: { page: 1, total: 0 } });
      expect(
        (await read({ ...first, teamBindingId: second.teamBindingId }))
          .pagination.total,
      ).toBe(0);
    });
    it("已成功但文件到期实时归入expired，类型和状态交集一致", async () => {
      const scope = await fixture();
      await db.insert(reportExports).values([
        {
          ...scope,
          requestedBy: userId,
          reportType: "answers",
          filters: {},
          idempotencyKey: randomUUID(),
          status: "succeeded",
          expiresAt: new Date(0),
        },
        {
          ...scope,
          requestedBy: userId,
          reportType: "answers",
          filters: {},
          idempotencyKey: randomUUID(),
          status: "succeeded",
          expiresAt: new Date("2099-01-01"),
        },
        {
          ...scope,
          requestedBy: userId,
          reportType: "domain_rank",
          filters: {},
          idempotencyKey: randomUUID(),
          status: "expired",
        },
      ]);
      const expired = await read(scope, { status: "expired" });
      expect(expired.pagination.total).toBe(2);
      expect(expired.list.every((row) => row.status === "expired")).toBe(true);
      expect(
        (await read(scope, { status: "expired", reportType: "answers" }))
          .pagination.total,
      ).toBe(1);
      expect(
        (await read(scope, { status: "succeeded" })).pagination.total,
      ).toBe(1);
    });
    it("北京时间提交日期包含当天边界，区别原报告数据日期", async () => {
      const scope = await fixture();
      const rows = await seed(scope, 1);
      expect(
        (await read(scope, { beginDate: "2026-09-02", endDate: "2026-09-02" }))
          .list[0].id,
      ).toBe(rows[0].id);
      expect(
        (await read(scope, { endDate: "2026-09-01" })).pagination.total,
      ).toBe(0);
      expect(
        (await read(scope, { beginDate: "2026-08-01", endDate: "2026-08-31" }))
          .pagination.total,
      ).toBe(0);
      expect(
        (await read(scope, { beginDate: "2026-09-02" })).pagination.total,
      ).toBe(1);
    });
    it("文件名、编号和原关键词检索，通配符按原文字匹配", async () => {
      const scope = await fixture();
      const [row] = await db
        .insert(reportExports)
        .values({
          ...scope,
          requestedBy: userId,
          reportType: "article_rank",
          filters: { keyword: "原问题_50%" },
          filename: "文件_50%.csv",
          idempotencyKey: randomUUID(),
          status: "failed",
        })
        .returning();
      await seed(scope, 2);
      for (const q of [row.id, "文件_50%", "原问题_50%", "_50%"]) {
        expect((await read(scope, { q })).list.map((item) => item.id)).toEqual([
          row.id,
        ]);
      }
      expect((await read(scope, { q: "不存在" })).pagination.total).toBe(0);
      expect(
        (await read(scope, { q: row.id, status: "queued" })).pagination.total,
      ).toBe(0);
    });
  },
);
