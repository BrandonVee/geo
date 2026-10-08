import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { notificationMetricPeriod } from "@geo/core";
import {
  db,
  pool,
  users,
  organizations,
  notificationRules,
  answerbitConnections,
  answerbitTeamBindings,
  answerbitBrandMappings,
  brandAccess,
  notifications,
  operationLogs,
  publishRuleNotification,
  isNotificationRuleEvaluable,
  type DatabaseTransaction,
} from "@geo/db";
import {
  notificationListQuerySchema,
  notificationRuleSchema,
} from "@geo/contracts";
import { writeAudit } from "@/server/audit/write-audit";
import { evaluateMetricAnomaly } from "@/server/services/notifications";
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
      const brandId = randomUUID();
      await db.insert(answerbitBrandMappings).values({
        organizationId,
        teamBindingId: binding.id,
        brandId,
        brandName: "Notification QA",
      });
      return {
        organizationId,
        teamBindingId: binding.id,
        brandId,
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
    const event = {
      severity: "warning" as const,
      title: "QA evaluated notification",
      message: "QA result from a previously loaded rule",
      payload: { available: 10 },
    };
    async function creditRule() {
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
      return { scope, input, rule: created.rule };
    }
    it.each([
      "suspended",
      "closed",
      "expired",
      "disabled_team",
      "foreign_team",
    ] as const)("%s 已提交后，旧规则不能发布或更新健康", async (change) => {
      const { scope, rule } = await creditRule();
      await repository.recordEvaluation(rule, "QA_EXISTING_FAILURE");
      const [before] = await db
        .select()
        .from(notificationRules)
        .where(eq(notificationRules.id, rule.id));
      if (change === "expired")
        await db
          .update(organizations)
          .set({ serviceExpiresAt: new Date(Date.now() - 1000) })
          .where(eq(organizations.id, scope.organizationId));
      else if (change === "suspended" || change === "closed")
        await db
          .update(organizations)
          .set({ status: change })
          .where(eq(organizations.id, scope.organizationId));
      else if (change === "disabled_team")
        await db
          .update(answerbitTeamBindings)
          .set({ status: "disabled" })
          .where(eq(answerbitTeamBindings.id, scope.teamBindingId));
      else {
        const other = await fixture();
        await db
          .update(answerbitTeamBindings)
          .set({ organizationId: other.organizationId })
          .where(eq(answerbitTeamBindings.id, scope.teamBindingId));
      }
      expect(await repository.publish(rule, event)).toBeUndefined();
      expect(await repository.recordEvaluation(rule)).toBe(false);
      expect(await repository.recordEvaluation(rule, "LATE_ERROR")).toBe(false);
      const [after] = await db
        .select()
        .from(notificationRules)
        .where(eq(notificationRules.id, rule.id));
      expect(after).toMatchObject({
        lastEvaluatedAt: before.lastEvaluatedAt,
        lastEvaluationError: "QA_EXISTING_FAILURE",
      });
    });
    it("等待企业冻结事务后，发布和健康写入必须复核已提交状态", async () => {
      const { scope, rule } = await creditRule();
      let entered!: () => void, release!: () => void;
      const editing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const freezing = db.transaction(async (tx) => {
        await tx
          .update(organizations)
          .set({ status: "suspended" })
          .where(eq(organizations.id, scope.organizationId));
        entered();
        await held;
      });
      await editing;
      const publishing = repository.publish(rule, event);
      const recording = repository.recordEvaluation(rule);
      try {
        await expect
          .poll(
            async () =>
              (
                await pool.query<{ waiting: number }>(
                  "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like '%organizations%'",
                )
              ).rows[0].waiting,
          )
          .toBeGreaterThanOrEqual(2);
      } finally {
        release();
        await freezing;
      }
      expect(await publishing).toBeUndefined();
      expect(await recording).toBe(false);
    });
    it("等待规则锁期间企业已到期，取得锁后不能发布或更新健康", async () => {
      const { scope, rule } = await creditRule();
      const expiresAt = new Date(Date.now() + 1000);
      await db
        .update(organizations)
        .set({ serviceExpiresAt: expiresAt })
        .where(eq(organizations.id, scope.organizationId));
      let entered!: () => void, release!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const locking = db.transaction(async (tx) => {
        await tx
          .select()
          .from(notificationRules)
          .where(eq(notificationRules.id, rule.id))
          .for("update");
        entered();
        await held;
      });
      await enteredPromise;
      const publishing = repository.publish(rule, event),
        recording = repository.recordEvaluation(rule);
      try {
        await expect
          .poll(
            async () =>
              (
                await pool.query<{ waiting: number }>(
                  "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like '%notification_rules%'",
                )
              ).rows[0].waiting,
          )
          .toBeGreaterThanOrEqual(2);
        await expect.poll(() => Date.now() >= expiresAt.getTime()).toBe(true);
      } finally {
        release();
        await locking;
      }
      expect(await publishing).toBeUndefined();
      expect(await recording).toBe(false);
    });
    it("指标规则的品牌映射失效后不再评估、发布或记录健康", async () => {
      const scope = await fixture();
      const created = await repository.createRule(
        notificationRuleSchema.parse({
          ...scope,
          type: "metric_anomaly",
          metric: "exposure",
          threshold: 20,
          windowDays: 7,
        }),
        userId,
        audit(scope.organizationId),
      );
      if (!created.ok) throw new Error("create failed");
      await db
        .delete(answerbitBrandMappings)
        .where(eq(answerbitBrandMappings.organizationId, scope.organizationId));
      expect(await isNotificationRuleEvaluable(created.rule)).toBe(false);
      expect(await repository.publish(created.rule, event)).toBeUndefined();
      expect(await repository.recordEvaluation(created.rule)).toBe(false);
    });
    it("历史空服务期限与连接异常仍允许健康记录和连接告警，积分到期不禁用通知", async () => {
      const { scope, rule } = await creditRule();
      await db
        .update(organizations)
        .set({
          serviceExpiresAt: null,
          pointsExpiresAt: new Date(Date.now() - 1000),
        })
        .where(eq(organizations.id, scope.organizationId));
      await db
        .update(answerbitTeamBindings)
        .set({ status: "invalid" })
        .where(eq(answerbitTeamBindings.id, scope.teamBindingId));
      expect(await isNotificationRuleEvaluable(rule)).toBe(true);
      expect(await repository.publish(rule, event)).toBeDefined();
      expect(await repository.recordEvaluation(rule)).toBe(true);
    });
    it.each([
      ["问题筛选", { titleIds: ["title"] }],
      ["模型筛选", { platforms: ["model"] }],
      ["标签筛选", { tagIds: ["tag"] }],
      ["不同窗口长度", { beginDate: "2026-02-22" }],
      ["历史同长度窗口", { beginDate: "2026-02-28", endDate: "2026-03-06" }],
      ["未来同长度窗口", { beginDate: "2026-03-02", endDate: "2026-03-08" }],
    ])(
      "%s 查询不发布告警或刷新规则健康，不占用正确评估的冷却窗口",
      async (_name, change) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-03-07T23:55:00Z"));
        try {
          const scope = await fixture();
          const created = await repository.createRule(
            notificationRuleSchema.parse({
              ...scope,
              type: "metric_anomaly",
              metric: "exposure",
              threshold: 20,
              windowDays: 7,
            }),
            userId,
            audit(scope.organizationId),
          );
          if (!created.ok) throw new Error("create failed");
          const result = {
            exposure: { value: 10, fluctuation: -30 },
            score: { value: 20, fluctuation: 0 },
            avg_rank: { value: 3, fluctuation: 0 },
          };
          const query = {
            beginDate: "2026-03-01",
            endDate: "2026-03-07",
            titleIds: [],
            platforms: [],
            tagIds: [],
          };
          await evaluateMetricAnomaly(
            scope.organizationId,
            scope.teamBindingId,
            scope.brandId,
            result,
            { ...query, ...change },
          );
          const [stored] = await db
            .select()
            .from(notificationRules)
            .where(eq(notificationRules.id, created.rule.id));
          expect(stored.lastEvaluatedAt).toBeNull();
          expect(
            await db
              .select()
              .from(notifications)
              .where(eq(notifications.ruleId, created.rule.id)),
          ).toHaveLength(0);
          await evaluateMetricAnomaly(
            scope.organizationId,
            scope.teamBindingId,
            scope.brandId,
            result,
            query,
          );
          const [evaluated] = await db
            .select()
            .from(notificationRules)
            .where(eq(notificationRules.id, created.rule.id));
          expect(evaluated.lastEvaluatedAt).toBeInstanceOf(Date);
          const notices = await db
            .select()
            .from(notifications)
            .where(eq(notifications.ruleId, created.rule.id));
          expect(notices).toHaveLength(1);
          expect(notices[0].payload).toMatchObject({
            windowDays: 7,
            fluctuation: -30,
          });
        } finally {
          vi.useRealTimers();
        }
      },
    );
    it.each(["publish", "health"] as const)(
      "Web %s 数据库故障只保存稳定错误码，健康写入失败有独立日志",
      async (phase) => {
        const scope = await fixture();
        const created = await repository.createRule(
          notificationRuleSchema.parse({
            ...scope,
            type: "metric_anomaly",
            metric: "exposure",
            threshold: 20,
            windowDays: 7,
          }),
          userId,
          audit(scope.organizationId),
        );
        if (!created.ok) throw new Error("create failed");
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        const table =
          phase === "publish" ? "notifications" : "notification_rules";
        const column = phase === "publish" ? "rule_id" : "id";
        const operation = phase === "publish" ? "insert" : "update";
        try {
          await pool.query(`create function qa_web_notification_failure() returns trigger language plpgsql as $$
          begin if NEW.${column} = '${created.rule.id}'::uuid then raise exception 'QA_PRIVATE_DATABASE_DETAIL'; end if; return NEW; end $$;
          create trigger qa_web_notification_failure before ${operation} on ${table} for each row execute function qa_web_notification_failure()`);
          await expect(
            evaluateMetricAnomaly(
              scope.organizationId,
              scope.teamBindingId,
              scope.brandId,
              {
                exposure: {
                  value: 10,
                  fluctuation: phase === "publish" ? -30 : 0,
                },
                score: { value: 20, fluctuation: 0 },
                avg_rank: { value: 3, fluctuation: 0 },
              },
              {
                ...notificationMetricPeriod(7),
                titleIds: [],
                platforms: [],
                tagIds: [],
              },
            ),
          ).resolves.toBeUndefined();
          const [stored] = await db
            .select()
            .from(notificationRules)
            .where(eq(notificationRules.id, created.rule.id));
          const events = log.mock.calls.map(([value]) =>
            JSON.parse(value as string),
          );
          expect(events).toContainEqual({
            event: "notification.evaluate.failed",
            ruleId: created.rule.id,
            errorCode: "NOTIFICATION_EVALUATION_FAILED",
          });
          if (phase === "publish") {
            expect(stored.lastEvaluationError).toBe(
              "NOTIFICATION_EVALUATION_FAILED",
            );
            expect(stored.lastEvaluatedAt).toBeInstanceOf(Date);
          } else {
            expect(stored.lastEvaluatedAt).toBeNull();
            expect(events).toContainEqual({
              event: "notification.evaluate.health-write-failed",
              ruleId: created.rule.id,
              errorCode: "NOTIFICATION_EVALUATION_FAILED",
            });
          }
          expect(JSON.stringify(events)).not.toMatch(
            /QA_PRIVATE_DATABASE_DETAIL|Failed query|params:/,
          );
        } finally {
          await pool.query(
            `drop trigger if exists qa_web_notification_failure on ${table}; drop function if exists qa_web_notification_failure()`,
          );
          log.mockRestore();
        }
      },
    );
    it("停用已提交后，先前加载的规则不能发布迟到通知", async () => {
      const { scope, rule } = await creditRule();
      await repository.disableRule(
        rule.id,
        scope.organizationId,
        userId,
        audit(scope.organizationId),
      );
      expect(await repository.publish(rule, event)).toBeUndefined();
      expect(
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.ruleId, rule.id)),
      ).toHaveLength(0);
    });
    it("新配置已提交后，旧阈值计算的通知不能被发布", async () => {
      const { scope, input, rule } = await creditRule();
      const changed = await repository.replaceRule(
        rule.id,
        { ...input, threshold: 5, expected: input },
        userId,
        audit(scope.organizationId),
      );
      if (!changed.ok) throw new Error("replace failed");
      expect(await repository.publish(rule, event)).toBeUndefined();
      expect(await repository.publish(changed.rule, event)).toBeDefined();
      expect(
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.ruleId, rule.id)),
      ).toHaveLength(1);
    });
    it("旧评估不能清空或覆盖新配置的健康状态，健康更新不阻止当前通知", async () => {
      const { scope, input, rule } = await creditRule();
      const changed = await repository.replaceRule(
        rule.id,
        { ...input, threshold: 900, expected: input },
        userId,
        audit(scope.organizationId),
      );
      if (!changed.ok) throw new Error("replace failed");
      expect(
        await repository.recordEvaluation(
          changed.rule,
          "NEW_EVALUATION_FAILED",
        ),
      ).toBe(true);
      const latest = await repository.findRule(rule.id, scope.organizationId);
      expect(await repository.recordEvaluation(rule)).toBe(false);
      expect(await repository.recordEvaluation(rule, "OLD_FAILURE")).toBe(
        false,
      );
      expect(await repository.findRule(rule.id, scope.organizationId)).toEqual(
        latest,
      );
      expect(await repository.publish(changed.rule, event)).toBeDefined();
    });
    it("停用后的迟到评估不再更新健康时间或错误状态", async () => {
      const { scope, rule } = await creditRule();
      const disabled = await repository.disableRule(
        rule.id,
        scope.organizationId,
        userId,
        audit(scope.organizationId),
      );
      expect(await repository.recordEvaluation(rule, "LATE_FAILURE")).toBe(
        false,
      );
      expect(await repository.findRule(rule.id, scope.organizationId)).toEqual(
        disabled,
      );
      expect(await repository.publish(disabled!, event)).toBeUndefined();
    });
    it("指标和取数窗口变更后，不发布旧样本计算的通知", async () => {
      const scope = await fixture();
      const input = notificationRuleSchema.parse({
        ...scope,
        type: "metric_anomaly",
        metric: "exposure",
        threshold: 20,
        windowDays: 7,
      });
      const created = await repository.createRule(
        input,
        userId,
        audit(scope.organizationId),
      );
      if (!created.ok || input.type !== "metric_anomaly")
        throw new Error("create failed");
      const changed = await repository.replaceRule(
        created.rule.id,
        { ...input, metric: "avg_rank", windowDays: 14, expected: input },
        userId,
        audit(scope.organizationId),
      );
      if (!changed.ok) throw new Error("replace failed");
      expect(await repository.publish(created.rule, event)).toBeUndefined();
      expect(await repository.recordEvaluation(created.rule)).toBe(false);
      expect(await repository.publish(changed.rule, event)).toBeDefined();
    });
    it("Web 与 Worker 并发发布共用规则锁，跨冷却分桶也不能重复通知", async () => {
      const { scope, input, rule } = await creditRule();
      const changed = await repository.replaceRule(
        rule.id,
        { ...input, cooldownMinutes: 5, expected: input },
        userId,
        audit(scope.organizationId),
      );
      if (!changed.ok) throw new Error("replace failed");
      const occurredAt = new Date("2026-09-01T00:04:59Z");
      const published = await Promise.all([
        repository.publish(changed.rule, { ...event, occurredAt }),
        publishRuleNotification(changed.rule, { ...event, occurredAt }),
      ]);
      expect(published.filter(Boolean)).toHaveLength(1);
      expect(
        await publishRuleNotification(changed.rule, {
          ...event,
          occurredAt: new Date("2026-09-01T00:05:01Z"),
        }),
      ).toBeUndefined();
      expect(
        await repository.publish(changed.rule, {
          ...event,
          occurredAt: new Date("2026-09-01T00:10:00Z"),
        }),
      ).toBeDefined();
    });
    it("等待配置写事务的发布，在取得行锁后再次校验，不能穿透未提交的停用", async () => {
      const { scope, rule } = await creditRule();
      let entered!: () => void, release!: () => void;
      const editing = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const disabling = repository.disableRule(
        rule.id,
        scope.organizationId,
        userId,
        async (tx, current) => {
          await audit(scope.organizationId)(tx, current);
          entered();
          await held;
        },
      );
      await editing;
      const publishing = publishRuleNotification(rule, event);
      try {
        await expect
          .poll(async () => {
            const result = await pool.query<{ waiting: number }>(
              "select count(*)::int as waiting from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock' and query like '%notification_rules%'",
            );
            return result.rows[0].waiting;
          })
          .toBeGreaterThan(0);
      } finally {
        release();
        await disabling;
      }
      expect(await publishing).toBeUndefined();
      expect(
        await db
          .select()
          .from(notifications)
          .where(eq(notifications.ruleId, rule.id)),
      ).toHaveLength(0);
    });
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
      await repository.recordEvaluation(created.rule, "QA_HEALTH");
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
