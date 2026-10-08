import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  answerbitConnections,
  answerbitBrandMappings,
  answerbitReadCache,
  answerbitTeamBindings,
  db,
  notificationRules,
  notifications,
  organizations,
  pool,
  users,
} from "@geo/db";
import { notificationMetricPeriod } from "@geo/core";
import { notificationRuleSchema } from "@geo/contracts";
import { notificationRepository } from "@/server/repositories/notifications";
import { evaluateMetricAnomaly } from "@/server/services/notifications";
import { cachedAnswerBitRead } from "./read-cache";
import { AnswerBitError } from "./errors";

describe.skipIf(process.env.NOTIFICATION_WORKFLOW_DB_TESTS !== "1")(
  "通知观察与读取缓存 PostgreSQL 回归",
  () => {
    const userId = randomUUID();
    const operation = "/geo/base/dashboard";
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
        throw new Error("Disposable QA database required");
      await db.insert(users).values({
        id: userId,
        name: "Read cache QA",
        email: `${userId}@test.invalid`,
      });
    });
    afterAll(async () => {
      await pool.end();
    });

    async function fixture() {
      const organizationId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "Read cache QA",
        slug: organizationId,
      });
      const [connection] = await db
        .insert(answerbitConnections)
        .values({
          organizationId,
          encryptedApiKey: "qa",
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
        brandName: "Read cache QA",
      });
      const created = await notificationRepository.createRule(
        notificationRuleSchema.parse({
          organizationId,
          teamBindingId: team.id,
          brandId,
          type: "metric_anomaly",
          metric: "exposure",
          threshold: 20,
          windowDays: 7,
        }),
        userId,
        async () => {},
      );
      if (!created.ok) throw new Error("create failed");
      const query = {
        ...notificationMetricPeriod(7),
        titleIds: [],
        platforms: [],
        tagIds: [],
      };
      const execute = vi.fn(async () => metrics);
      const onFreshResult = vi.fn(async (response: typeof metrics) => {
        // An independent connection must already see the committed snapshot.
        expect(await cacheRows()).toHaveLength(1);
        await evaluateMetricAnomaly(
          organizationId,
          team.id,
          brandId,
          response,
          query,
        );
      });
      const read = () =>
        cachedAnswerBitRead({
          operation,
          organizationId,
          brandId,
          actorUserId: userId,
          apiKey: "qa",
          payload: {
            brand_id: brandId,
            begin_date: query.beginDate,
            end_date: query.endDate,
            title_ids: [],
            platforms: [],
            tag_ids: [],
          },
          execute,
          onFreshResult,
        });
      const cacheRows = () =>
        db
          .select()
          .from(answerbitReadCache)
          .where(eq(answerbitReadCache.organizationId, organizationId));
      const notices = () =>
        db
          .select()
          .from(notifications)
          .where(eq(notifications.ruleId, created.rule.id));
      const rule = async () =>
        (
          await db
            .select()
            .from(notificationRules)
            .where(eq(notificationRules.id, created.rule.id))
        )[0];
      const markFailure = async () => {
        await db
          .update(notificationRules)
          .set({ lastEvaluationError: "QA_RECENT_DETECTION_FAILURE" })
          .where(eq(notificationRules.id, created.rule.id));
        return rule();
      };
      const expire = (checkedAt?: Date) =>
        db
          .update(answerbitReadCache)
          .set({
            expiresAt: new Date(Date.now() - 1000),
            ...(checkedAt ? { checkedAt } : {}),
          })
          .where(eq(answerbitReadCache.organizationId, organizationId));
      return {
        organizationId,
        read,
        execute,
        onFreshResult,
        cacheRows,
        notices,
        rule,
        markFailure,
        expire,
      };
    }

    it("真实上游结果在缓存提交后发布通知和记录健康", async () => {
      const f = await fixture();
      expect(await f.read()).toEqual(metrics);
      expect(f.execute).toHaveBeenCalledTimes(1);
      expect(f.onFreshResult).toHaveBeenCalledTimes(1);
      expect((await f.rule()).lastEvaluatedAt).toBeInstanceOf(Date);
      expect((await f.rule()).lastEvaluationError).toBeNull();
      expect(await f.notices()).toHaveLength(1);
    });

    it("普通缓存命中不刷新健康或清除最近的检测错误", async () => {
      const f = await fixture();
      await f.read();
      const previous = await f.markFailure();
      expect(await f.read()).toEqual(metrics);
      expect(f.execute).toHaveBeenCalledTimes(1);
      expect(f.onFreshResult).toHaveBeenCalledTimes(1);
      expect(await f.rule()).toMatchObject({
        lastEvaluatedAt: previous.lastEvaluatedAt,
        lastEvaluationError: previous.lastEvaluationError,
      });
      expect(await f.notices()).toHaveLength(1);
    });

    it("429 旧快照及冷却命中不清除检测错误，真实读取恢复后才更新健康", async () => {
      const f = await fixture();
      await f.read();
      const previous = await f.markFailure();
      await f.expire(new Date(Date.now() - 2 * 60 * 60_000));
      f.execute.mockRejectedValueOnce(
        new AnswerBitError("rate_limited", operation, 429, undefined, 60_000),
      );
      expect(await f.read()).toEqual(metrics);
      expect(await f.read()).toEqual(metrics);
      expect(f.execute).toHaveBeenCalledTimes(2);
      expect(f.onFreshResult).toHaveBeenCalledTimes(1);
      expect(await f.rule()).toMatchObject({
        lastEvaluatedAt: previous.lastEvaluatedAt,
        lastEvaluationError: previous.lastEvaluationError,
      });
      await f.expire();
      expect(await f.read()).toEqual(metrics);
      expect(f.onFreshResult).toHaveBeenCalledTimes(2);
      expect((await f.rule()).lastEvaluationError).toBeNull();
      expect(await f.notices()).toHaveLength(1);
    });

    it.each(["upstream", "expired"] as const)(
      "%s 读取失败不触发通知观察",
      async (kind) => {
        const f = await fixture();
        await f.read();
        const previous = await f.markFailure();
        await f.expire(
          kind === "expired"
            ? new Date(Date.now() - 8 * 24 * 60 * 60_000)
            : undefined,
        );
        const error = new AnswerBitError(
          kind === "expired" ? "rate_limited" : "upstream",
          operation,
          kind === "expired" ? 429 : 500,
        );
        f.execute.mockRejectedValueOnce(error);
        await expect(f.read()).rejects.toBe(error);
        expect(f.onFreshResult).toHaveBeenCalledTimes(1);
        expect(await f.rule()).toMatchObject({
          lastEvaluatedAt: previous.lastEvaluatedAt,
          lastEvaluationError: previous.lastEvaluationError,
        });
      },
    );

    it("缓存事务失败不发布尚未提交的通知观察", async () => {
      const f = await fixture();
      await pool.query(`create function qa_read_cache_failure() returns trigger language plpgsql as $$
        begin if NEW.organization_id = '${f.organizationId}'::uuid then raise exception 'QA_CACHE_WRITE_FAILED'; end if; return NEW; end $$;
        create trigger qa_read_cache_failure before insert on answerbit_read_cache for each row execute function qa_read_cache_failure()`);
      try {
        await expect(f.read()).rejects.toThrow();
      } finally {
        await pool.query(
          "drop trigger qa_read_cache_failure on answerbit_read_cache; drop function qa_read_cache_failure()",
        );
      }
      expect(f.execute).toHaveBeenCalledTimes(1);
      expect(f.onFreshResult).not.toHaveBeenCalled();
      expect(await f.cacheRows()).toHaveLength(0);
      expect(await f.notices()).toHaveLength(0);
      expect((await f.rule()).lastEvaluatedAt).toBeNull();
    });

    it("并发缓存失效只请求一次上游并执行一次真实通知观察", async () => {
      const f = await fixture();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => f.read()),
      );
      expect(
        results.every((result) => result.exposure.fluctuation === -30),
      ).toBe(true);
      expect(f.execute).toHaveBeenCalledTimes(1);
      expect(f.onFreshResult).toHaveBeenCalledTimes(1);
      expect(await f.notices()).toHaveLength(1);
    });
  },
);
