import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  users,
  organizations,
  answerbitConnections,
  answerbitTeamBindings,
  brandAccess,
  notifications,
  operationLogs,
  type DatabaseTransaction,
} from "@geo/db";
import {
  notificationListQuerySchema,
  notificationRuleSchema,
} from "@geo/contracts";
import { writeAudit } from "@/server/audit/write-audit";
import {
  notificationRepository as repository,
  type StoredNotificationRule,
} from "./notifications";

describe.skipIf(process.env.NOTIFICATION_WORKFLOW_DB_TESTS !== "1")(
  "通知工作流 PostgreSQL 回归",
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
          name: "Notification QA",
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
        name: "Notification QA",
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
    const audit =
      (organizationId: string) =>
      (tx: DatabaseTransaction, rule: StoredNotificationRule) =>
        writeAudit(
          { organizationId, actorUserId: userId, requestId: randomUUID() },
          {
            operation: "notification-rule.update",
            resourceType: "notification_rule",
            resourceId: rule.id,
          },
          tx,
        );
    const logs = (organizationId: string) =>
      db
        .select()
        .from(operationLogs)
        .where(eq(operationLogs.organizationId, organizationId));
    async function seedNotices(
      scope: Awaited<ReturnType<typeof fixture>>,
      size = 123,
    ) {
      return db
        .insert(notifications)
        .values(
          Array.from({ length: size }, (_, i) => ({
            ...scope,
            type: "metric_anomaly" as const,
            severity: i % 2 ? ("critical" as const) : ("warning" as const),
            title: `Notice ${i}`,
            message: "QA",
            eventKey: randomUUID(),
            occurredAt: new Date("2026-09-01T16:00:00Z"),
          })),
        )
        .returning();
    }
    it("超过50条历史可稳定翻页，超界回退，其他企业不计入", async () => {
      const scope = await fixture(),
        other = await fixture();
      const rows = await seedNotices(scope);
      await seedNotices(other, 3);
      const seen: string[] = [];
      for (let page = 1; page <= 7; page++) {
        const result = await repository.list(
          scope.organizationId,
          userId,
          notificationListQuerySchema.parse({
            organizationId: scope.organizationId,
            page,
          }),
          true,
        );
        expect(result.total).toBe(123);
        expect(result.unreadCount).toBe(123);
        seen.push(...result.list.map((row) => row.id));
      }
      expect(seen).toEqual(
        rows
          .map((row) => row.id)
          .sort()
          .reverse(),
      );
      const end = await repository.list(
        scope.organizationId,
        userId,
        notificationListQuerySchema.parse({
          organizationId: scope.organizationId,
          page: 999,
        }),
        true,
      );
      expect(end.page).toBe(7);
      expect(end.list).toHaveLength(3);
    });
    it("日期、类型、程度取交集；批量跨页已读幂等且用户独立", async () => {
      const scope = await fixture();
      await seedNotices(scope);
      const filters = {
        organizationId: scope.organizationId,
        type: "metric_anomaly" as const,
        severity: "critical" as const,
        beginDate: "2026-09-02",
        endDate: "2026-09-02",
      };
      expect(await repository.readAll(filters, userId, true)).toEqual({
        count: 61,
      });
      expect(await repository.readAll(filters, userId, true)).toEqual({
        count: 0,
      });
      const current = await repository.list(
        scope.organizationId,
        userId,
        notificationListQuerySchema.parse({
          ...filters,
          unreadOnly: true,
          page: 4,
        }),
        true,
      );
      expect(current).toMatchObject({
        total: 0,
        unreadCount: 62,
        page: 1,
        list: [],
      });
      const other = await repository.list(
        scope.organizationId,
        otherUserId,
        notificationListQuerySchema.parse(filters),
        true,
      );
      expect(other.total).toBe(61);
      expect(other.unreadCount).toBe(123);
      expect(other.list.every((row) => row.readAt === null)).toBe(true);
      const outside = await repository.list(
        scope.organizationId,
        userId,
        notificationListQuerySchema.parse({
          ...filters,
          endDate: "2026-09-01",
          beginDate: "2026-09-01",
        }),
        true,
      );
      expect(outside.total).toBe(0);
    });
    it("品牌范围限制查询与批量已读，企业级通知不可越权读取", async () => {
      const scope = await fixture();
      const rows = await seedNotices(scope, 3);
      await db.insert(notifications).values({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        type: "low_credits",
        title: "Enterprise private",
        message: "QA",
        eventKey: randomUUID(),
      });
      await db
        .insert(brandAccess)
        .values({ ...scope, userId, role: "brand_admin" });
      const query = notificationListQuerySchema.parse({
        organizationId: scope.organizationId,
      });
      expect(
        (await repository.list(scope.organizationId, userId, query, false))
          .total,
      ).toBe(3);
      expect(
        await repository.readAll(
          { organizationId: scope.organizationId },
          otherUserId,
          false,
        ),
      ).toEqual({ count: 0 });
      expect(
        await repository.readAll(
          { organizationId: scope.organizationId },
          userId,
          false,
        ),
      ).toEqual({ count: 3 });
      await repository.setRead(rows[0].id, scope.organizationId, userId, false);
      expect(
        (await repository.list(scope.organizationId, userId, query, false))
          .unreadCount,
      ).toBe(1);
      expect(
        (await repository.list(scope.organizationId, otherUserId, query, true))
          .unreadCount,
      ).toBe(4);
    });
    it("并发创建只写一个规则和审计，同范围不同输入或操作者被拒绝", async () => {
      const scope = await fixture();
      const input = notificationRuleSchema.parse({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        type: "low_credits",
        threshold: 1000,
      });
      const results = await Promise.all([
        repository.createRule(input, userId, audit(scope.organizationId)),
        repository.createRule(input, userId, audit(scope.organizationId)),
      ]);
      expect(
        results.filter((result) => result.ok && result.replayed),
      ).toHaveLength(1);
      expect(await logs(scope.organizationId)).toHaveLength(1);
      expect(
        await repository.createRule(
          { ...input, threshold: 1200 },
          userId,
          audit(scope.organizationId),
        ),
      ).toMatchObject({ ok: false, code: "NOTIFICATION_RULE_EXISTS" });
      expect(
        await repository.createRule(
          input,
          otherUserId,
          audit(scope.organizationId),
        ),
      ).toMatchObject({ ok: false, code: "NOTIFICATION_RULE_EXISTS" });
    });
    it("审计失败使创建、更新全回滚，原配置可重试", async () => {
      const scope = await fixture();
      const input = notificationRuleSchema.parse({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        type: "low_credits",
        threshold: 1000,
      });
      const fail = async () => {
        throw new Error("audit failure");
      };
      await expect(repository.createRule(input, userId, fail)).rejects.toThrow(
        "audit failure",
      );
      expect(
        await repository.listRules(scope.organizationId, userId),
      ).toHaveLength(0);
      const created = await repository.createRule(
        input,
        userId,
        audit(scope.organizationId),
      );
      if (!created.ok) throw new Error("create failed");
      await expect(
        repository.replaceRule(
          created.rule.id,
          { ...input, threshold: 900, expected: input },
          userId,
          fail,
        ),
      ).rejects.toThrow("audit failure");
      expect(
        (await repository.findRule(created.rule.id, scope.organizationId))
          ?.threshold,
      ).toBe(1000);
      expect(await logs(scope.organizationId)).toHaveLength(1);
    });
    it("Worker健康时间不造成冲突；并发旧配置拒绝，重放不重复审计", async () => {
      const scope = await fixture();
      const input = notificationRuleSchema.parse({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        type: "low_credits",
        threshold: 1000,
      });
      const created = await repository.createRule(
        input,
        userId,
        audit(scope.organizationId),
      );
      if (!created.ok) throw new Error("create failed");
      await repository.recordEvaluation(created.rule.id, "QA_HEALTH");
      const result = await repository.replaceRule(
        created.rule.id,
        { ...input, threshold: 900, expected: input },
        userId,
        audit(scope.organizationId),
      );
      expect(result).toMatchObject({
        ok: true,
        replayed: false,
        rule: { threshold: 900, lastEvaluationError: "QA_HEALTH" },
      });
      const conflict = await repository.replaceRule(
        created.rule.id,
        { ...input, threshold: 800, expected: input },
        otherUserId,
        audit(scope.organizationId),
      );
      expect(conflict).toMatchObject({
        ok: false,
        code: "NOTIFICATION_RULE_CONFLICT",
        current: { threshold: 900 },
      });
      expect(
        await repository.replaceRule(
          created.rule.id,
          { ...input, threshold: 900, expected: input },
          userId,
          audit(scope.organizationId),
        ),
      ).toMatchObject({ ok: true, replayed: true });
      expect(await logs(scope.organizationId)).toHaveLength(2);
      await repository.disableRule(
        created.rule.id,
        scope.organizationId,
        userId,
        audit(scope.organizationId),
      );
      await repository.disableRule(
        created.rule.id,
        scope.organizationId,
        userId,
        audit(scope.organizationId),
      );
      expect(await logs(scope.organizationId)).toHaveLength(3);
      expect(
        await repository.replaceRule(
          created.rule.id,
          {
            ...input,
            organizationId: (await fixture()).organizationId,
            expected: input,
          },
          userId,
          audit(scope.organizationId),
        ),
      ).toMatchObject({ ok: false, code: "NOTIFICATION_RULE_NOT_FOUND" });
    });
  },
);
