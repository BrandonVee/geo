import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import {
  answerbitConnections,
  answerbitTeamBindings,
  articleGenerationJobs,
  balanceAccounts,
  balanceTransactions,
  beginArticleCreate,
  consumeBalance,
  db,
  failArticleJob,
  featurePointCosts,
  organizations,
  pool,
  recordArticleCreateReceipt,
  recoverArticleJob,
  redeliverArticleJob,
  users,
  type SqlExecutor,
} from "@geo/db";
import {
  createArticleOnce,
  ArticleCreationUncertainError,
} from "./article-create";
import {
  AnswerBitHttpError,
  InvalidAnswerBitDataError,
} from "./answerbit-response";

// @project-doc docs/domains/geo_operations.md#article_jobs
describe.skipIf(process.env.ARTICLE_DISPATCH_DB_TESTS !== "1")(
  "文章派发 PostgreSQL / pg-boss 崩溃恢复回归",
  () => {
    const userId = randomUUID(),
      organizationId = randomUUID(),
      teamBindingId = randomUUID();
    const queue = "article-dispatch-qa";
    let boss: PgBoss;
    const old = () => new Date(Date.now() - 60 * 60_000);
    const cutoff = () => new Date(Date.now() - 15 * 60_000);
    const fixture = async (
      overrides: Partial<typeof articleGenerationJobs.$inferInsert> = {},
    ) => {
      const [job] = await db
        .insert(articleGenerationJobs)
        .values({
          organizationId,
          teamBindingId,
          brandId: randomUUID(),
          requestedBy: userId,
          idempotencyKey: randomUUID(),
          status: "running",
          executionId: randomUUID(),
          attemptCount: 1,
          startedAt: old(),
          updatedAt: old(),
          pricingSnapshot: {
            tier: "retail",
            basePoints: 0,
            pointMarkupBps: 0,
            points: 0,
          },
          ...overrides,
        })
        .returning();
      return job;
    };
    type Job = Awaited<ReturnType<typeof fixture>>;
    const execution = (job: Job) => ({
      organizationId,
      jobId: job.id,
      executionId: job.executionId!,
    });
    const recovery = (job: Job) => ({
      organizationId,
      jobId: job.id,
      expectedQueueJobId: job.queueJobId,
      expectedExecutionId: job.executionId,
      status: job.status as "queued" | "running",
      staleBefore: cutoff(),
      queueState: null,
    });
    const enqueue = async (
      data: { organizationId: string; jobId: string },
      executor: SqlExecutor,
    ) => {
      const id = await boss.send(queue, data, { db: executor, retryLimit: 0 });
      if (!id) throw new Error("TEST_ENQUEUE_FAILED");
      return id;
    };
    const read = async (job: Job) =>
      (
        await db
          .select()
          .from(articleGenerationJobs)
          .where(eq(articleGenerationJobs.id, job.id))
      )[0];
    const stale = async (job: Job) => {
      await db
        .update(articleGenerationJobs)
        .set({ updatedAt: old() })
        .where(eq(articleGenerationJobs.id, job.id));
    };
    const charge = async (job: Job) => {
      await db.insert(balanceAccounts).values({
        organizationId,
        brandId: job.brandId,
        asset: "answerbit_points",
        balance: 100,
      });
      expect(
        (
          await consumeBalance({
            organizationId,
            brandId: job.brandId,
            asset: "answerbit_points",
            amount: 13,
            referenceType: "feature_usage",
            referenceId: job.id,
            idempotencyKey: `feature:ai_article_generation:${job.id}:consume`,
            reason: "派发测试",
            actorUserId: userId,
          })
        ).ok,
      ).toBe(true);
    };
    const ledger = async (job: Job) =>
      db
        .select()
        .from(balanceTransactions)
        .where(
          and(
            eq(balanceTransactions.organizationId, organizationId),
            eq(balanceTransactions.referenceId, job.id),
          ),
        );
    const queueCount = async (job: Job) =>
      (
        await pool.query<{ count: number }>(
          "select count(*)::int as count from pgboss.job where name = $1 and data->>'jobId' = $2",
          [queue, job.id],
        )
      ).rows[0].count;

    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error(
          "Article dispatch QA requires the disposable workflow database",
        );
      await db.insert(users).values({
        id: userId,
        name: "article-dispatch-qa",
        email: `${userId}@test.invalid`,
      });
      await db.insert(organizations).values({
        id: organizationId,
        name: "article-dispatch-qa",
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
      await db.insert(answerbitTeamBindings).values({
        id: teamBindingId,
        organizationId,
        connectionId: connection.id,
        teamId: randomUUID(),
      });
      boss = new PgBoss(process.env.DATABASE_URL!);
      await boss.start();
      await boss.createQueue(queue);
    });
    afterAll(async () => {
      await boss?.stop();
      await pool.end();
    });

    it("同租约并发仅一次真实派发，第二调用不能终结仍在运行的第一次调用", async () => {
      const job = await fixture();
      let entered!: () => void, release!: () => void;
      const sent = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const send = vi.fn(async () => {
        entered();
        await held;
        return { id: "upstream-concurrent" };
      });
      const create = async ({
        beforeSend,
      }: {
        beforeSend: () => Promise<void>;
      }) => {
        await beforeSend();
        return send();
      };
      const first = createArticleOnce(execution(job), create);
      await sent;
      try {
        expect(await createArticleOnce(execution(job), create)).toEqual({
          kind: "skipped",
        });
        expect(await read(job)).toMatchObject({
          status: "running",
          executionId: job.executionId,
          answerbitArticleId: null,
        });
        expect(send).toHaveBeenCalledOnce();
      } finally {
        release();
      }
      expect(await first).toEqual({
        kind: "created",
        articleId: "upstream-concurrent",
      });
      expect((await read(job)).answerbitArticleId).toBe("upstream-concurrent");
    });

    const paidFixture = async (balance = 100) => {
      const job = await fixture({
        pricingSnapshot: {
          tier: "silver",
          basePoints: 10,
          pointMarkupBps: 1500,
          points: 12,
        },
      });
      await db.insert(balanceAccounts).values({
        organizationId,
        brandId: job.brandId,
        asset: "answerbit_points",
        balance,
      });
      return job;
    };

    it("首次扣费与派发权原子提交，同租约并发只按任务价格扣一次", async () => {
      const job = await paidFixture();
      const results = await Promise.all([
        beginArticleCreate(execution(job)),
        beginArticleCreate(execution(job)),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await ledger(job)).toEqual([
        expect.objectContaining({
          operation: "consume",
          amount: 12,
          sourceBalanceAfter: 88,
          actorUserId: userId,
        }),
      ]);
      expect(
        await failArticleJob({
          ...execution(job),
          errorCode: "ARTICLE_CREATE_FAILED",
        }),
      ).toBe(true);
      expect(await ledger(job)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            operation: "restore",
            amount: 12,
            targetBalanceAfter: 100,
          }),
        ]),
      );
      expect(await ledger(job)).toHaveLength(2);
    });

    it("历史无价格快照任务在当前事务读取计价，沿用原操作用户等级", async () => {
      const [original] = await db
        .select()
        .from(featurePointCosts)
        .where(eq(featurePointCosts.featureCode, "ai_article_generation"));
      const job = await paidFixture();
      await db
        .update(articleGenerationJobs)
        .set({ pricingSnapshot: null })
        .where(eq(articleGenerationJobs.id, job.id));
      await db
        .update(featurePointCosts)
        .set({ points: 10 })
        .where(eq(featurePointCosts.featureCode, "ai_article_generation"));
      try {
        expect(await beginArticleCreate(execution(job))).toBeInstanceOf(Date);
        expect(await ledger(job)).toEqual([
          expect.objectContaining({ amount: 13, sourceBalanceAfter: 87 }),
        ]);
      } finally {
        await db
          .update(featurePointCosts)
          .set({ points: original.points })
          .where(eq(featurePointCosts.featureCode, "ai_article_generation"));
      }
    });

    it("零积分任务在派发事务中仍校验企业积分有效期，不生成零元流水", async () => {
      const job = await fixture();
      await db
        .update(organizations)
        .set({ pointsExpiresAt: old() })
        .where(eq(organizations.id, organizationId));
      try {
        await expect(beginArticleCreate(execution(job))).rejects.toMatchObject({
          code: "POINTS_EXPIRED",
        });
        expect((await read(job)).createDispatchedAt).toBeNull();
        expect(await ledger(job)).toHaveLength(0);
      } finally {
        await db
          .update(organizations)
          .set({ pointsExpiresAt: null })
          .where(eq(organizations.id, organizationId));
      }
      expect(await beginArticleCreate(execution(job))).toBeInstanceOf(Date);
      expect(await ledger(job)).toHaveLength(0);
    });

    it("积分不足不取得派发权，补足余额后原租约可重试", async () => {
      const job = await paidFixture(11);
      await expect(beginArticleCreate(execution(job))).rejects.toThrow(
        "ANSWERBIT_POINTS_INSUFFICIENT",
      );
      expect((await read(job)).createDispatchedAt).toBeNull();
      expect(await ledger(job)).toHaveLength(0);
      await db
        .update(balanceAccounts)
        .set({ balance: 100 })
        .where(eq(balanceAccounts.brandId, job.brandId));
      expect(await beginArticleCreate(execution(job))).toBeInstanceOf(Date);
      expect(await ledger(job)).toHaveLength(1);
    });

    it("派发标记写入异常时扣款整体回滚，重试后只扣一次", async () => {
      const job = await paidFixture();
      await pool.query(`create function qa_article_dispatch_failure() returns trigger language plpgsql as $$
        begin if NEW.create_dispatched_at is not null then raise exception 'QA_DISPATCH_WRITE_FAILED'; end if; return NEW; end $$;
        create trigger qa_article_dispatch_failure before update on article_generation_jobs
        for each row execute function qa_article_dispatch_failure()`);
      try {
        await expect(beginArticleCreate(execution(job))).rejects.toThrow();
      } finally {
        await pool.query(
          "drop trigger qa_article_dispatch_failure on article_generation_jobs; drop function qa_article_dispatch_failure()",
        );
      }
      expect((await read(job)).createDispatchedAt).toBeNull();
      expect(await ledger(job)).toHaveLength(0);
      const [account] = await db
        .select()
        .from(balanceAccounts)
        .where(eq(balanceAccounts.brandId, job.brandId));
      expect(account.balance).toBe(100);
      expect(await beginArticleCreate(execution(job))).toBeInstanceOf(Date);
      expect(await ledger(job)).toHaveLength(1);
    });

    it("终态、已知上游ID和恢复后的旧租约均不能产生新的扣费", async () => {
      for (const status of ["failed", "cancelled", "succeeded"] as const) {
        const job = await paidFixture();
        await db
          .update(articleGenerationJobs)
          .set({ status })
          .where(eq(articleGenerationJobs.id, job.id));
        expect(await beginArticleCreate(execution(job))).toBeNull();
        expect(await ledger(job)).toHaveLength(0);
      }
      const known = await paidFixture();
      await db
        .update(articleGenerationJobs)
        .set({ answerbitArticleId: "already-created" })
        .where(eq(articleGenerationJobs.id, known.id));
      expect(await beginArticleCreate(execution(known))).toBeNull();
      expect(await ledger(known)).toHaveLength(0);
      const recovered = await paidFixture();
      expect(await recoverArticleJob(recovery(recovered), enqueue)).toBe(
        "requeue",
      );
      expect(await beginArticleCreate(execution(recovered))).toBeNull();
      expect(await ledger(recovered)).toHaveLength(0);
    });

    it("零元任务派发后崩溃被标记待核对，重启不会第二次调用上游", async () => {
      const job = await fixture();
      expect(await beginArticleCreate(execution(job))).toBeInstanceOf(Date);
      await stale(job);
      const send = vi.fn();
      expect(await recoverArticleJob(recovery(job), enqueue)).toBe(
        "fail_uncertain",
      );
      expect(
        await createArticleOnce(execution(job), async ({ beforeSend }) => {
          await beforeSend();
          return send();
        }),
      ).toEqual({ kind: "skipped" });
      expect(await read(job)).toMatchObject({
        status: "failed",
        errorCode: "ARTICLE_RECOVERY_UNCERTAIN",
        executionId: null,
      });
      expect(await ledger(job)).toHaveLength(0);
      expect(await queueCount(job)).toBe(0);
      expect(send).not.toHaveBeenCalled();
    });

    it("历史 queued 任务有派发记录时不能走提交重投递或自动重建", async () => {
      const job = await fixture({
        status: "queued",
        executionId: null,
        createDispatchedAt: old(),
      });
      expect(
        await redeliverArticleJob(
          { organizationId, jobId: job.id, expectedQueueJobId: null },
          enqueue,
        ),
      ).toBe(false);
      expect(await recoverArticleJob(recovery(job), enqueue)).toBe(
        "fail_uncertain",
      );
      expect(await queueCount(job)).toBe(0);
    });

    it("未派发任务的状态重置与 pg-boss 投递原子提交，投递后异常整体回滚", async () => {
      const job = await fixture();
      await expect(
        recoverArticleJob(recovery(job), async (...args) => {
          await enqueue(...args);
          throw new Error("ROLLBACK_AFTER_ENQUEUE");
        }),
      ).rejects.toThrow("ROLLBACK_AFTER_ENQUEUE");
      expect(await read(job)).toMatchObject({
        status: "running",
        executionId: job.executionId,
        queueJobId: null,
      });
      expect(await queueCount(job)).toBe(0);
      expect(await recoverArticleJob(recovery(job), enqueue)).toBe("requeue");
      expect(await read(job)).toMatchObject({
        status: "queued",
        executionId: null,
        createDispatchedAt: null,
        startedAt: null,
      });
      expect(await queueCount(job)).toBe(1);
      expect(await beginArticleCreate(execution(job))).toBeNull();
    });

    it("派发和恢复争抢同一行锁时，不能同时派发和重投递", async () => {
      for (let i = 0; i < 6; i++) {
        const job = await fixture();
        const [marker, action] = await Promise.all([
          beginArticleCreate(execution(job)),
          recoverArticleJob(recovery(job), enqueue),
        ]);
        if (marker) {
          expect(action).toBe("superseded");
          expect(await queueCount(job)).toBe(0);
          expect((await read(job)).status).toBe("running");
        } else {
          expect(action).toBe("requeue");
          expect(await queueCount(job)).toBe(1);
          expect((await read(job)).createDispatchedAt).toBeNull();
        }
      }
    });

    it("已知上游ID只恢复查询；活跃队列与新鲜租约不被恢复器终结", async () => {
      const polling = await fixture({
        answerbitArticleId: "known-id",
        createDispatchedAt: old(),
      });
      expect(await recoverArticleJob(recovery(polling), enqueue)).toBe(
        "requeue",
      );
      expect((await read(polling)).answerbitArticleId).toBe("known-id");
      expect(await queueCount(polling)).toBe(1);
      const active = await fixture({ createDispatchedAt: old() });
      expect(
        await recoverArticleJob(
          { ...recovery(active), queueState: "active" },
          enqueue,
        ),
      ).toBe("none");
      expect((await read(active)).status).toBe("running");
      const fresh = await fixture();
      await beginArticleCreate(execution(fresh));
      expect(await recoverArticleJob(recovery(fresh), enqueue)).toBe(
        "superseded",
      );
    });

    it("有偿不确定任务的失败与返还一起提交，并发结算及恢复重放只退款一次", async () => {
      const job = await fixture();
      await charge(job);
      await beginArticleCreate(execution(job));
      await stale(job);
      const results = await Promise.all([
        recoverArticleJob(recovery(job), enqueue),
        failArticleJob({
          ...execution(job),
          errorCode: "ANSWERBIT_CREATE_UNCERTAIN",
        }),
      ]);
      expect(results[0] === "fail_uncertain" || results[1] === true).toBe(true);
      expect(
        await failArticleJob({
          ...execution(job),
          errorCode: "ANSWERBIT_CREATE_UNCERTAIN",
        }),
      ).toBe(false);
      expect(await recoverArticleJob(recovery(job), enqueue)).toBe(
        "superseded",
      );
      expect(await ledger(job)).toHaveLength(2);
      const [account] = await db
        .select()
        .from(balanceAccounts)
        .where(
          and(
            eq(balanceAccounts.organizationId, organizationId),
            eq(balanceAccounts.brandId, job.brandId),
          ),
        );
      expect(account.balance).toBe(100);
      expect((await read(job)).status).toBe("failed");
    });

    it("恢复后的迟到ID保留核对证据，但不复活任务或撤销退款", async () => {
      const job = await fixture();
      await charge(job);
      const dispatchedAt = (await beginArticleCreate(execution(job)))!;
      await stale(job);
      expect(await recoverArticleJob(recovery(job), enqueue)).toBe(
        "fail_uncertain",
      );
      expect(
        await recordArticleCreateReceipt({
          ...execution(job),
          dispatchedAt,
          articleId: "late-id",
        }),
      ).toBe(false);
      expect(await read(job)).toMatchObject({
        status: "failed",
        executionId: null,
        answerbitArticleId: "late-id",
        errorCode: "ARTICLE_RECOVERY_UNCERTAIN",
      });
      expect(await ledger(job)).toHaveLength(2);
    });

    it("ID写入异常保留派发门闩并返回不确定，不会再次创建上游文章", async () => {
      const job = await fixture();
      await pool.query(`create function qa_article_receipt_failure() returns trigger language plpgsql as $$
        begin if NEW.answerbit_article_id = 'qa-receipt-error' then raise exception 'QA_RECEIPT_WRITE_FAILED'; end if; return NEW; end $$;
        create trigger qa_article_receipt_failure before update on article_generation_jobs
        for each row execute function qa_article_receipt_failure()`);
      const send = vi.fn().mockResolvedValue({ id: "qa-receipt-error" });
      try {
        await expect(
          createArticleOnce(execution(job), async ({ beforeSend }) => {
            await beforeSend();
            return send();
          }),
        ).rejects.toBeInstanceOf(ArticleCreationUncertainError);
      } finally {
        await pool.query(
          "drop trigger qa_article_receipt_failure on article_generation_jobs; drop function qa_article_receipt_failure()",
        );
      }
      expect((await read(job)).createDispatchedAt).toBeInstanceOf(Date);
      expect((await read(job)).answerbitArticleId).toBeNull();
      await stale(job);
      expect(await recoverArticleJob(recovery(job), enqueue)).toBe(
        "fail_uncertain",
      );
      expect(await beginArticleCreate(execution(job))).toBeNull();
      expect(send).toHaveBeenCalledOnce();
    });

    it("失败状态写入失败时返还流水一起回滚，重试结算才产生一次退款", async () => {
      const job = await fixture();
      await charge(job);
      await pool.query(`create function qa_article_status_failure() returns trigger language plpgsql as $$
        begin if NEW.error_code = 'QA_FAIL_STATUS' then raise exception 'QA_STATUS_WRITE_FAILED'; end if; return NEW; end $$;
        create trigger qa_article_status_failure before update on article_generation_jobs
        for each row execute function qa_article_status_failure()`);
      try {
        await expect(
          failArticleJob({ ...execution(job), errorCode: "QA_FAIL_STATUS" }),
        ).rejects.toThrow();
      } finally {
        await pool.query(
          "drop trigger qa_article_status_failure on article_generation_jobs; drop function qa_article_status_failure()",
        );
      }
      expect(await ledger(job)).toHaveLength(1);
      expect((await read(job)).status).toBe("running");
      expect(
        await failArticleJob({
          ...execution(job),
          errorCode: "ARTICLE_CREATE_FAILED",
        }),
      ).toBe(true);
      expect(await ledger(job)).toHaveLength(2);
    });

    it.each([new AnswerBitHttpError(503), new InvalidAnswerBitDataError()])(
      "上游 %s 进入持久化不确定状态，结算后不会重发",
      async (error) => {
        const job = await fixture();
        const send = vi.fn().mockRejectedValue(error);
        await expect(
          createArticleOnce(execution(job), async ({ beforeSend }) => {
            await beforeSend();
            return send();
          }),
        ).rejects.toBeInstanceOf(ArticleCreationUncertainError);
        expect(
          await failArticleJob({
            ...execution(job),
            errorCode: "ANSWERBIT_CREATE_UNCERTAIN",
          }),
        ).toBe(true);
        expect(await beginArticleCreate(execution(job))).toBeNull();
        expect(send).toHaveBeenCalledOnce();
        expect(await read(job)).toMatchObject({
          status: "failed",
          errorCode: "ANSWERBIT_CREATE_UNCERTAIN",
        });
      },
    );

    it("跨企业、失效租约和伪造派发时间不能取得派发权或写入回执", async () => {
      const job = await fixture();
      expect(
        await beginArticleCreate({
          ...execution(job),
          organizationId: randomUUID(),
        }),
      ).toBeNull();
      expect(
        await beginArticleCreate({
          ...execution(job),
          executionId: randomUUID(),
        }),
      ).toBeNull();
      const dispatchedAt = (await beginArticleCreate(execution(job)))!;
      await expect(
        recordArticleCreateReceipt({
          ...execution(job),
          dispatchedAt: new Date(dispatchedAt.getTime() - 1),
          articleId: "fake",
        }),
      ).rejects.toThrow("ARTICLE_CREATE_RECEIPT_CONFLICT");
      expect((await read(job)).answerbitArticleId).toBeNull();
    });
  },
);
