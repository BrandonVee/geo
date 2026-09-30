import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  answerBitArticleCreatePayloadSchema,
  createArticleJobSchema,
} from "@geo/contracts";
import {
  answerbitConnections,
  answerbitTeamBindings,
  articleGenerationJobs,
  balanceTransactions,
  db,
  operationLogs,
  organizations,
  pool,
  redeliverArticleJob,
  scheduleArticleResultPoll,
  users,
} from "@geo/db";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  templates: vi.fn(),
  afterEnqueue: undefined as undefined | (() => Promise<void>),
}));
// Keep real submission, pricing, encryption, audit and pg-boss transactions.
// Authorization has separate coverage; upstream template reads stay local.
vi.mock("@/server/permissions/brand-scope", () => ({
  authorizeBrand: vi.fn(),
}));
vi.mock("@/server/integrations/answerbit/context", () => ({
  loadAnswerBitTeamContext: mocks.context,
}));
vi.mock("@/server/integrations/answerbit/gateway", () => ({
  queryArticleTemplatesLogged: mocks.templates,
}));
vi.mock("@/server/jobs/boss", async (original) => {
  const actual = await original<typeof import("@/server/jobs/boss")>();
  return {
    ...actual,
    prepareArticleGenerationQueue: async () => {
      const enqueue = await actual.prepareArticleGenerationQueue();
      return async (...args: Parameters<typeof enqueue>) => {
        const id = await enqueue(...args);
        await mocks.afterEnqueue?.();
        return id;
      };
    },
  };
});
import { getBoss, prepareArticleGenerationQueue } from "@/server/jobs/boss";
import { getSecretCipher } from "@/server/security/secret-cipher";
import { getPointBilledFeatureQuote } from "./feature-billing";
import { articleService } from "./articles";

describe.skipIf(process.env.ARTICLE_SUBMISSION_DB_TESTS !== "1")(
  "文章生成提交 PostgreSQL / pg-boss 回归",
  () => {
    const userId = randomUUID();
    let input: ReturnType<typeof createArticleJobSchema.parse>;
    let pricing: Awaited<ReturnType<typeof getPointBilledFeatureQuote>>;
    const audit = () => ({
      organizationId: input.organizationId,
      actorUserId: userId,
      requestId: randomUUID(),
    });
    const create = (key: string = randomUUID()) =>
      articleService.createJob(input, key, userId, randomUUID(), audit());
    const counts = async () => {
      const [jobs, audits, balances, queue] = await Promise.all([
        db
          .select()
          .from(articleGenerationJobs)
          .where(
            eq(articleGenerationJobs.organizationId, input.organizationId),
          ),
        db
          .select()
          .from(operationLogs)
          .where(eq(operationLogs.organizationId, input.organizationId)),
        db
          .select()
          .from(balanceTransactions)
          .where(eq(balanceTransactions.organizationId, input.organizationId)),
        pool.query<{ count: number }>(
          "select count(*)::int as count from pgboss.job where name = 'article-generation' and data->>'organizationId' = $1",
          [input.organizationId],
        ),
      ]);
      return {
        jobs: jobs.length,
        audits: audits.length,
        balances: balances.length,
        queue: queue.rows[0].count,
      };
    };
    const legacy = async (
      status: typeof articleGenerationJobs.$inferSelect.status = "queued",
    ) => {
      const payload = answerBitArticleCreatePayloadSchema.parse({
        brand_id: input.brandId,
        template_type: input.templateType,
        prompt_ids: input.promptIds,
        knowledge_ids: input.knowledgeIds,
        once_knowledge: input.supplementalKnowledge,
        high_ref: input.highReference,
        tag_ids: input.tagIds,
        language: input.language,
      });
      const [job] = await db
        .insert(articleGenerationJobs)
        .values({
          organizationId: input.organizationId,
          teamBindingId: input.teamBindingId,
          brandId: input.brandId,
          requestedBy: userId,
          idempotencyKey: randomUUID(),
          pricingSnapshot: pricing,
          templateType: input.templateType,
          language: input.language,
          status,
          tags: input.contentTags.map((tagName) => ({
            tagId: `local:${tagName.toLocaleLowerCase()}`,
            tagName,
          })),
          requestPayload: {
            ciphertext: getSecretCipher().encrypt(
              JSON.stringify(payload),
              input.organizationId,
            ),
          },
        })
        .returning();
      return job;
    };

    beforeAll(async () => {
      if (
        process.env.WORKFLOW_DISPOSABLE_DB !== "1" ||
        !/^\/geo_workflow_qa_[a-f0-9]+$/.test(
          new URL(process.env.DATABASE_URL!).pathname,
        )
      )
        throw new Error("Article QA requires the disposable workflow database");
      await db.insert(users).values({
        id: userId,
        name: "article-submission-qa",
        email: `${userId}@test.invalid`,
      });
      await prepareArticleGenerationQueue();
    });
    beforeEach(async () => {
      mocks.afterEnqueue = undefined;
      mocks.templates.mockReset();
      mocks.templates.mockResolvedValue([{ template_id: 1, is_high_ref: 0 }]);
      const organizationId = randomUUID(),
        teamBindingId = randomUUID();
      await db.insert(organizations).values({
        id: organizationId,
        name: "article-submission-qa",
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
      mocks.context.mockResolvedValue({ connection, apiKey: "qa" });
      pricing = await getPointBilledFeatureQuote(
        "ai_article_generation",
        userId,
      );
      input = createArticleJobSchema.parse({
        organizationId,
        teamBindingId,
        brandId: randomUUID(),
        expectedPoints: pricing.points,
        templateType: 1,
        promptIds: ["prompt-qa"],
        supplementalKnowledge: "私有生成素材",
        contentTags: ["文章提交回归"],
      });
    });
    afterAll(async () => {
      await getBoss().stop();
      const globalBoss = globalThis as typeof globalThis & {
        geoBoss?: unknown;
        geoBossStart?: unknown;
      };
      delete globalBoss.geoBoss;
      delete globalBoss.geoBossStart;
      await pool.end();
    });

    it("提交前 Worker 看不到任务；同键并发只有一个任务和审计", async () => {
      const key = randomUUID();
      let signal!: () => void, release!: () => void;
      const enqueued = new Promise<void>((resolve) => {
        signal = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.afterEnqueue = async () => {
        signal();
        await held;
      };
      const first = create(key);
      await enqueued;
      const second = create(key);
      try {
        expect(await counts()).toEqual({
          jobs: 0,
          audits: 0,
          balances: 0,
          queue: 0,
        });
        const fetched = await getBoss().fetch<{ organizationId: string }>(
          "article-generation",
          { batchSize: 100 },
        );
        expect(
          fetched.some(
            (job) => job.data.organizationId === input.organizationId,
          ),
        ).toBe(false);
      } finally {
        release();
      }
      const results = await Promise.all([first, second]);
      expect(new Set(results.map((job) => job.id)).size).toBe(1);
      expect(results.filter((job) => !job.replayed)).toHaveLength(1);
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 1,
        balances: 0,
        queue: 1,
      });
      expect(JSON.stringify(results)).not.toContain("ciphertext");
      expect(JSON.stringify(results)).not.toContain("私有生成素材");
      await expect(
        articleService.createJob(
          { ...input, supplementalKnowledge: "其他素材" },
          key,
          userId,
          randomUUID(),
          audit(),
        ),
      ).rejects.toMatchObject({ code: "ARTICLE_JOB_IDEMPOTENCY_CONFLICT" });
      await expect(
        articleService.createJob(
          input,
          key,
          randomUUID(),
          randomUUID(),
          audit(),
        ),
      ).rejects.toMatchObject({ code: "ARTICLE_JOB_IDEMPOTENCY_CONFLICT" });
    });
    it("实际入队后发生错误，任务和队列一起回滚；同键可重试", async () => {
      const key = randomUUID();
      mocks.afterEnqueue = async () => {
        throw new Error("AFTER_QUEUE_INSERT");
      };
      await expect(create(key)).rejects.toMatchObject({
        status: 503,
        code: "ARTICLE_QUEUE_UNAVAILABLE",
      });
      expect(await counts()).toEqual({
        jobs: 0,
        audits: 0,
        balances: 0,
        queue: 0,
      });
      mocks.afterEnqueue = undefined;
      expect(await create(key)).toMatchObject({
        status: "queued",
        replayed: false,
      });
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 1,
        balances: 0,
        queue: 1,
      });
    });
    it("审计写入失败不能留下可执行或会扣积分的任务", async () => {
      const key = randomUUID();
      await expect(
        articleService.createJob(input, key, userId, randomUUID(), {
          ...audit(),
          requestId: "x".repeat(500),
        }),
      ).rejects.toThrow();
      expect(await counts()).toEqual({
        jobs: 0,
        audits: 0,
        balances: 0,
        queue: 0,
      });
      await create(key);
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 1,
        balances: 0,
        queue: 1,
      });
    });
    it("并发恢复未入队任务保留原请求、价格和任务编号，不再次读取模板", async () => {
      const job = await legacy();
      mocks.templates.mockRejectedValue(
        new Error("template reads unavailable"),
      );
      const results = await Promise.all([
        create(job.idempotencyKey),
        create(job.idempotencyKey),
      ]);
      expect(results.every((row) => row.id === job.id && row.replayed)).toBe(
        true,
      );
      const [saved] = await db
        .select()
        .from(articleGenerationJobs)
        .where(eq(articleGenerationJobs.id, job.id));
      expect(saved.queueJobId).toBeTruthy();
      expect(saved.pricingSnapshot).toEqual(job.pricingSnapshot);
      expect(saved.requestPayload).toEqual(job.requestPayload);
      expect(mocks.templates).not.toHaveBeenCalled();
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 1,
        balances: 0,
        queue: 1,
      });
      const [entry] = await db
        .select()
        .from(operationLogs)
        .where(eq(operationLogs.resourceId, job.id));
      expect(entry.operation).toBe("answerbit.article.submission.recover");
    });
    it("旧任务恢复入队失败保持可重试，不生成新的任务", async () => {
      const job = await legacy();
      mocks.afterEnqueue = async () => {
        throw new Error("repair failed");
      };
      await expect(create(job.idempotencyKey)).rejects.toMatchObject({
        code: "ARTICLE_QUEUE_UNAVAILABLE",
      });
      const [saved] = await db
        .select()
        .from(articleGenerationJobs)
        .where(eq(articleGenerationJobs.id, job.id));
      expect(saved).toMatchObject({
        status: "queued",
        queueJobId: null,
        completedAt: null,
      });
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 0,
        balances: 0,
        queue: 0,
      });
      mocks.afterEnqueue = undefined;
      expect(await create(job.idempotencyKey)).toMatchObject({
        id: job.id,
        replayed: true,
      });
    });
    it("自动补投失败回滚队列编号；并发恢复不重复投递", async () => {
      const job = await legacy();
      const candidate = {
        organizationId: input.organizationId,
        jobId: job.id,
        expectedQueueJobId: null,
      };
      const enqueue = await prepareArticleGenerationQueue();
      expect(
        await redeliverArticleJob(
          {
            ...candidate,
            organizationId: randomUUID(),
          },
          enqueue,
        ),
      ).toBe(false);
      mocks.afterEnqueue = async () => {
        throw new Error("redelivery failed");
      };
      await expect(redeliverArticleJob(candidate, enqueue)).rejects.toThrow(
        "redelivery failed",
      );
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 0,
        balances: 0,
        queue: 0,
      });
      mocks.afterEnqueue = undefined;
      const results = await Promise.all([
        redeliverArticleJob(candidate, enqueue),
        redeliverArticleJob(candidate, enqueue),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 0,
        balances: 0,
        queue: 1,
      });
      expect(await create(job.idempotencyKey)).toMatchObject({
        id: job.id,
        replayed: true,
      });
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 0,
        balances: 0,
        queue: 1,
      });
    });
    it("文章结果查询失败保留执行租约；成功投递后旧执行不能再调度", async () => {
      const job = await legacy("running");
      const executionId = randomUUID(),
        oldQueueJobId = randomUUID();
      await db
        .update(articleGenerationJobs)
        .set({
          executionId,
          queueJobId: oldQueueJobId,
          answerbitArticleId: "upstream-article",
        })
        .where(eq(articleGenerationJobs.id, job.id));
      const candidate = {
        organizationId: input.organizationId,
        jobId: job.id,
        executionId,
      };
      const enqueue = await prepareArticleGenerationQueue();
      expect(
        await scheduleArticleResultPoll(
          { ...candidate, executionId: randomUUID() },
          enqueue,
        ),
      ).toBe(false);
      mocks.afterEnqueue = async () => {
        throw new Error("poll failed");
      };
      await expect(
        scheduleArticleResultPoll(candidate, enqueue),
      ).rejects.toThrow("poll failed");
      const [unchanged] = await db
        .select()
        .from(articleGenerationJobs)
        .where(eq(articleGenerationJobs.id, job.id));
      expect(unchanged).toMatchObject({
        status: "running",
        executionId,
        queueJobId: oldQueueJobId,
      });
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 0,
        balances: 0,
        queue: 0,
      });
      mocks.afterEnqueue = undefined;
      const results = await Promise.all([
        scheduleArticleResultPoll(candidate, enqueue),
        scheduleArticleResultPoll(candidate, enqueue),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const [scheduled] = await db
        .select()
        .from(articleGenerationJobs)
        .where(eq(articleGenerationJobs.id, job.id));
      expect(scheduled).toMatchObject({
        status: "running",
        executionId: null,
        answerbitArticleId: "upstream-article",
      });
      expect(scheduled.queueJobId).not.toBe(oldQueueJobId);
      expect(scheduled.pricingSnapshot).toEqual(pricing);
      expect(await scheduleArticleResultPoll(candidate, enqueue)).toBe(false);
      expect(await counts()).toEqual({
        jobs: 1,
        audits: 0,
        balances: 0,
        queue: 1,
      });
    });
    it("报价变化或生成方式不匹配时不创建任务和队列", async () => {
      await expect(
        articleService.createJob(
          { ...input, expectedPoints: pricing.points + 1 },
          randomUUID(),
          userId,
          randomUUID(),
          audit(),
        ),
      ).rejects.toMatchObject({ code: "FEATURE_PRICE_CHANGED" });
      await expect(
        articleService.createJob(
          { ...input, highReference: { url: "https://example.com/article" } },
          randomUUID(),
          userId,
          randomUUID(),
          audit(),
        ),
      ).rejects.toMatchObject({ code: "ARTICLE_REFERENCE_NOT_ALLOWED" });
      expect(await counts()).toEqual({
        jobs: 0,
        audits: 0,
        balances: 0,
        queue: 0,
      });
    });
    it.each(["running", "failed", "cancelled", "succeeded"] as const)(
      "%s 任务重放不会重新入队",
      async (status) => {
        const job = await legacy(status);
        mocks.afterEnqueue = async () => {
          throw new Error("must not enqueue");
        };
        expect(await create(job.idempotencyKey)).toMatchObject({
          id: job.id,
          status,
          replayed: true,
        });
        expect(await counts()).toEqual({
          jobs: 1,
          audits: 0,
          balances: 0,
          queue: 0,
        });
        expect(mocks.templates).not.toHaveBeenCalled();
      },
    );
  },
);
