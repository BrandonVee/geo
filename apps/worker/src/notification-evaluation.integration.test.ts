import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  answerbitConnections,
  answerbitApiCalls,
  answerbitBrandMappings,
  answerbitTeamBindings,
  balanceAccounts,
  db,
  notificationRules,
  notifications,
  organizations,
  pool,
  users,
} from "@geo/db";
import {
  evaluateNotificationRules,
  type NotificationEvaluationItem,
} from "./notification-evaluation";
import { runtimeTaskErrorCode } from "./runtime-task";

describe.skipIf(process.env.NOTIFICATION_EVALUATION_DB_TESTS !== "1")(
  "通知评估批处理 PostgreSQL 回归",
  () => {
    const userId = randomUUID();
    const metrics = {
      exposure: { value: 10, fluctuation: -30 },
      score: { value: 20, fluctuation: 0 },
      avg_rank: { value: 3, fluctuation: 0 },
    };
    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error(
          "Notification evaluation QA requires a disposable database",
        );
      await db.insert(users).values({
        id: userId,
        name: "Notification evaluation QA",
        email: `${userId}@test.invalid`,
      });
    });
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      await pool.end();
    });

    async function fixture(
      type:
        | "metric_anomaly"
        | "low_credits"
        | "connection_failure" = "metric_anomaly",
    ) {
      const organizationId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "Notification evaluation QA",
        slug: organizationId,
      });
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId,
          encryptedApiKey: "unused-qa",
          apiKeyFingerprint: randomUUID(),
          apiKeyHint: "qa",
          createdBy: userId,
        })
        .returning();
      const [team] = await db
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
        teamBindingId: team.id,
        brandId,
        brandName: "Notification evaluation QA",
      });
      const [rule] = await db
        .insert(notificationRules)
        .values({
          organizationId,
          teamBindingId: team.id,
          brandId: type === "metric_anomaly" ? brandId : null,
          type,
          metric: type === "metric_anomaly" ? "exposure" : null,
          threshold: type === "connection_failure" ? 2 : 20,
          windowDays: type === "metric_anomaly" ? 7 : null,
          scopeKey:
            type === "metric_anomaly" ? `${team.id}:${brandId}` : team.id,
          updatedBy: userId,
        })
        .returning();
      return { team, rule };
    }
    const observe = () => ({
      info: vi.spyOn(console, "info").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    });
    const stored = async (id: string) =>
      (
        await db
          .select()
          .from(notificationRules)
          .where(eq(notificationRules.id, id))
      )[0];
    const summary = (info: ReturnType<typeof observe>["info"]) =>
      info.mock.calls
        .map(([value]) => JSON.parse(value as string))
        .find((value) => value.event === "notification-evaluation.completed");
    it.each([
      "before",
      "during",
      "during_failure",
      "changed",
      "unmapped",
    ] as const)(
      "%s 失效规则计为跳过，不发布或改健康，后续规则正常完成",
      async (phase) => {
        const bad = await fixture(),
          good = await fixture();
        const logs = observe();
        if (phase === "before")
          await db
            .update(organizations)
            .set({ status: "suspended" })
            .where(eq(organizations.id, bad.rule.organizationId));
        else if (phase === "changed")
          await db
            .update(notificationRules)
            .set({ threshold: 25 })
            .where(eq(notificationRules.id, bad.rule.id));
        else if (phase === "unmapped")
          await db
            .delete(answerbitBrandMappings)
            .where(
              eq(
                answerbitBrandMappings.organizationId,
                bad.rule.organizationId,
              ),
            );
        const fetchMetrics = vi.fn(
          async (rule: NotificationEvaluationItem["rule"]) => {
            if (
              (phase === "during" || phase === "during_failure") &&
              rule.id === bad.rule.id
            )
              await db
                .update(organizations)
                .set({ status: "suspended" })
                .where(eq(organizations.id, bad.rule.organizationId));
            if (phase === "during_failure" && rule.id === bad.rule.id)
              throw new Error("ANSWERBIT_TIMEOUT");
            return metrics;
          },
        );
        expect(
          await evaluateNotificationRules([bad, good], fetchMetrics),
        ).toEqual({ evaluated: 1, emitted: 1, failed: 0, skipped: 1 });
        expect(fetchMetrics).toHaveBeenCalledTimes(
          phase === "during" || phase === "during_failure" ? 2 : 1,
        );
        expect(logs.error).not.toHaveBeenCalled();
        expect((await stored(bad.rule.id)).lastEvaluatedAt).toBeNull();
        expect((await stored(good.rule.id)).lastEvaluatedAt).toBeInstanceOf(
          Date,
        );
        expect(
          await db
            .select()
            .from(notifications)
            .where(eq(notifications.ruleId, bad.rule.id)),
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(notifications)
            .where(eq(notifications.ruleId, good.rule.id)),
        ).toHaveLength(1);
      },
    );

    it("单条上游失败仍完成后续规则，批次明确失败而不是上报成功", async () => {
      const bad = await fixture(),
        good = await fixture();
      const logs = observe();
      const fetchMetrics = vi.fn(
        async (rule: NotificationEvaluationItem["rule"]) => {
          if (rule.id === bad.rule.id) throw new Error("ANSWERBIT_TIMEOUT");
          return metrics;
        },
      );
      const result = await evaluateNotificationRules(
        [bad, good],
        fetchMetrics,
      ).catch((error) => error);
      expect(fetchMetrics).toHaveBeenCalledTimes(2);
      expect((await stored(bad.rule.id)).lastEvaluationError).toBe(
        "ANSWERBIT_TIMEOUT",
      );
      expect((await stored(good.rule.id)).lastEvaluatedAt).toBeInstanceOf(Date);
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe("NOTIFICATION_EVALUATION_PARTIAL_FAILURE");
      expect(runtimeTaskErrorCode("notification-evaluation", result)).toBe(
        "NOTIFICATION_EVALUATION_PARTIAL_FAILURE",
      );
      expect(summary(logs.info)).toEqual({
        event: "notification-evaluation.completed",
        evaluated: 1,
        emitted: 1,
        failed: 1,
        skipped: 0,
      });
    });

    it.each(["upstream", "health"] as const)(
      "%s 故障且错误健康记录也无法写入时，后续规则仍正常发布和记录健康",
      async (phase) => {
        const bad = await fixture(),
          good = await fixture();
        const logs = observe();
        const fetchMetrics = vi.fn(
          async (rule: NotificationEvaluationItem["rule"]) => {
            if (rule.id === bad.rule.id) {
              if (phase === "upstream") throw new Error("ANSWERBIT_TIMEOUT");
              return { ...metrics, exposure: { value: 10, fluctuation: 0 } };
            }
            return metrics;
          },
        );
        // A real database failure affects both the initial health write and
        // the attempt to persist its error, without replacing the repository.
        await pool.query(`create function qa_notification_health_failure() returns trigger language plpgsql as $$
          begin if NEW.id = '${bad.rule.id}'::uuid then raise exception 'QA_HEALTH_WRITE_FAILED'; end if; return NEW; end $$;
          create trigger qa_notification_health_failure before update on notification_rules
          for each row execute function qa_notification_health_failure()`);
        let result: unknown;
        try {
          result = await evaluateNotificationRules(
            [bad, good],
            fetchMetrics,
          ).catch((error) => error);
        } finally {
          await pool.query(
            "drop trigger qa_notification_health_failure on notification_rules; drop function qa_notification_health_failure()",
          );
        }
        expect(fetchMetrics).toHaveBeenCalledTimes(2);
        expect((await stored(good.rule.id)).lastEvaluatedAt).toBeInstanceOf(
          Date,
        );
        expect((await stored(good.rule.id)).lastEvaluationError).toBeNull();
        expect((await stored(bad.rule.id)).lastEvaluatedAt).toBeNull();
        expect(result).toBeInstanceOf(Error);
        expect((result as Error).message).toBe(
          "NOTIFICATION_EVALUATION_PARTIAL_FAILURE",
        );
        expect(summary(logs.info)).toEqual({
          event: "notification-evaluation.completed",
          evaluated: 1,
          emitted: 1,
          failed: 1,
          skipped: 0,
        });
        expect(
          await db
            .select()
            .from(notifications)
            .where(eq(notifications.ruleId, good.rule.id)),
        ).toHaveLength(1);
        expect(
          logs.error.mock.calls.map(([value]) => JSON.parse(value as string)),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              event: "notification-evaluation.health-write-failed",
              ruleId: bad.rule.id,
            }),
          ]),
        );
      },
    );

    it("正常批次记录所有规则健康，通知冷却重放不额外发布", async () => {
      const alert = await fixture(),
        quiet = await fixture();
      const logs = observe();
      const fetchMetrics = vi.fn(
        async (rule: NotificationEvaluationItem["rule"]) =>
          rule.id === alert.rule.id
            ? metrics
            : {
                ...metrics,
                exposure: { value: 10, fluctuation: 0 },
              },
      );
      expect(
        await evaluateNotificationRules([alert, quiet], fetchMetrics),
      ).toEqual({
        evaluated: 2,
        emitted: 1,
        failed: 0,
        skipped: 0,
      });
      expect(
        await evaluateNotificationRules([alert, quiet], fetchMetrics),
      ).toEqual({
        evaluated: 2,
        emitted: 0,
        failed: 0,
        skipped: 0,
      });
      for (const item of [alert, quiet]) {
        expect((await stored(item.rule.id)).lastEvaluatedAt).toBeInstanceOf(
          Date,
        );
        expect((await stored(item.rule.id)).lastEvaluationError).toBeNull();
      }
      expect(logs.error).not.toHaveBeenCalled();
    });

    it("低积分与连接失败继续使用本地品牌账本和真实调用日志，无需请求腾讯", async () => {
      const credit = await fixture("low_credits"),
        connection = await fixture("connection_failure");
      const [brand] = await db
        .select()
        .from(answerbitBrandMappings)
        .where(
          eq(answerbitBrandMappings.organizationId, credit.rule.organizationId),
        );
      await db.insert(balanceAccounts).values({
        organizationId: credit.rule.organizationId,
        brandId: brand.brandId,
        asset: "answerbit_points",
        balance: 10,
      });
      await db.insert(answerbitApiCalls).values(
        Array.from({ length: 5 }, () => ({
          organizationId: connection.rule.organizationId,
          connectionId: connection.team.connectionId,
          operation: "/geo/article/get",
          requestId: randomUUID(),
          status: "failed" as const,
          durationMs: 1,
          errorCode: "ANSWERBIT_TIMEOUT",
        })),
      );
      observe();
      const fetchMetrics = vi.fn(async () => metrics);
      expect(
        await evaluateNotificationRules([credit, connection], fetchMetrics),
      ).toEqual({
        evaluated: 2,
        emitted: 2,
        failed: 0,
        skipped: 0,
      });
      expect(fetchMetrics).not.toHaveBeenCalled();
      const [creditNotice] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.ruleId, credit.rule.id));
      expect(creditNotice).toMatchObject({
        severity: "warning",
        payload: { available: 10 },
      });
      const [connectionNotice] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.ruleId, connection.rule.id));
      expect(connectionNotice).toMatchObject({
        severity: "critical",
        payload: { consecutiveFailures: 5 },
      });
    });

    it("没有可评估规则时报告零统计，不读取上游或写错误状态", async () => {
      const logs = observe();
      const fetchMetrics = vi.fn(async () => metrics);
      expect(await evaluateNotificationRules([], fetchMetrics)).toEqual({
        evaluated: 0,
        emitted: 0,
        failed: 0,
        skipped: 0,
      });
      expect(fetchMetrics).not.toHaveBeenCalled();
      expect(logs.error).not.toHaveBeenCalled();
    });
  },
);
