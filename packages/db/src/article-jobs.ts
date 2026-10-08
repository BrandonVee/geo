import { and, eq, isNull, isNotNull, or, lte } from "drizzle-orm";
import { decideAsyncJobRecovery, type QueueJobState } from "@geo/core";
import { db } from "./client";
import { consumeBalance, restoreBalance } from "./balances";
import { getEffectiveFeaturePointCost } from "./pricing";
import {
  withDatabaseTransaction,
  type DatabaseTransaction,
  type SqlExecutor,
} from "./context";
import { articleGenerationJobs, balanceTransactions } from "./schema";

type ArticleExecution = {
  organizationId: string;
  jobId: string;
  executionId: string;
};

// @project-doc docs/domains/geo_operations.md#article_jobs
export async function beginArticleCreate(input: ArticleExecution) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.id, input.jobId),
          eq(articleGenerationJobs.organizationId, input.organizationId),
          eq(articleGenerationJobs.executionId, input.executionId),
          eq(articleGenerationJobs.status, "running"),
          isNull(articleGenerationJobs.answerbitArticleId),
          isNull(articleGenerationJobs.createDispatchedAt),
        ),
      )
      .for("update");
    // The lease, debit, and dispatch marker share the recovery/failure row lock.
    if (!job) return null;
    const pricing =
      job.pricingSnapshot ??
      (await getEffectiveFeaturePointCost(
        "ai_article_generation",
        job.requestedBy,
        tx,
      ));
    const consumed = await consumeBalance(
      {
        organizationId: job.organizationId,
        brandId: job.brandId,
        asset: "answerbit_points",
        amount: pricing.points,
        referenceType: "feature_usage",
        referenceId: job.id,
        idempotencyKey: `feature:ai_article_generation:${job.id}:consume`,
        reason: `AI 文章生成功能计费（${pricing.tier}）`,
        actorUserId: job.requestedBy,
      },
      tx,
    );
    if (!consumed.ok) throw new Error("ANSWERBIT_POINTS_INSUFFICIENT");
    const dispatchedAt = new Date();
    await tx
      .update(articleGenerationJobs)
      .set({ createDispatchedAt: dispatchedAt, updatedAt: dispatchedAt })
      .where(eq(articleGenerationJobs.id, job.id));
    return dispatchedAt;
  });
}

export function recordArticleCreateReceipt(
  input: ArticleExecution & { dispatchedAt: Date; articleId: string },
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.id, input.jobId),
          eq(articleGenerationJobs.organizationId, input.organizationId),
          eq(articleGenerationJobs.createDispatchedAt, input.dispatchedAt),
        ),
      )
      .for("update");
    if (
      !job ||
      (job.answerbitArticleId && job.answerbitArticleId !== input.articleId)
    )
      throw new Error("ARTICLE_CREATE_RECEIPT_CONFLICT");
    if (!job.answerbitArticleId)
      await tx
        .update(articleGenerationJobs)
        .set({ answerbitArticleId: input.articleId, updatedAt: new Date() })
        .where(eq(articleGenerationJobs.id, job.id));
    // A late receipt is retained without reviving a completed lease or refund.
    return job.status === "running" && job.executionId === input.executionId;
  });
}

async function refundArticleCharge(
  tx: DatabaseTransaction,
  job: typeof articleGenerationJobs.$inferSelect,
) {
  const [charge] = await tx
    .select({ amount: balanceTransactions.amount })
    .from(balanceTransactions)
    .where(
      and(
        eq(balanceTransactions.organizationId, job.organizationId),
        eq(
          balanceTransactions.idempotencyKey,
          `feature:ai_article_generation:${job.id}:consume`,
        ),
      ),
    )
    .limit(1);
  if (charge)
    await restoreBalance(
      {
        organizationId: job.organizationId,
        brandId: job.brandId,
        asset: "answerbit_points",
        amount: charge.amount,
        referenceType: "feature_usage_failed",
        referenceId: job.id,
        idempotencyKey: `feature:ai_article_generation:${job.id}:restore`,
        reason: "AI 文章生成失败返还",
        actorUserId: job.requestedBy,
      },
      tx,
    );
}

export function failArticleJob(
  input: ArticleExecution & { errorCode: string },
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.id, input.jobId),
          eq(articleGenerationJobs.organizationId, input.organizationId),
          eq(articleGenerationJobs.executionId, input.executionId),
          eq(articleGenerationJobs.status, "running"),
        ),
      )
      .for("update");
    if (!job) return false;
    await refundArticleCharge(tx, job);
    await tx
      .update(articleGenerationJobs)
      .set({
        status: "failed",
        errorCode: input.errorCode,
        completedAt: new Date(),
        executionId: null,
        updatedAt: new Date(),
      })
      .where(eq(articleGenerationJobs.id, job.id));
    return true;
  });
}

type EnqueueArticleJob = (
  data: { organizationId: string; jobId: string },
  executor: SqlExecutor,
) => Promise<string>;
async function enqueueLockedArticleJob(
  tx: DatabaseTransaction,
  executor: SqlExecutor,
  job: { id: string; organizationId: string },
  enqueue: EnqueueArticleJob,
) {
  const queueJobId = await enqueue(
    { organizationId: job.organizationId, jobId: job.id },
    executor,
  );
  await tx
    .update(articleGenerationJobs)
    .set({
      queueJobId,
      executionId: null,
      errorCode: null,
      updatedAt: new Date(),
    })
    .where(eq(articleGenerationJobs.id, job.id));
  return true;
}

// @project-doc docs/domains/geo_operations.md#article_jobs
export function redeliverArticleJob(
  input: {
    organizationId: string;
    jobId: string;
    expectedQueueJobId: string | null;
  },
  enqueue: EnqueueArticleJob,
) {
  return withDatabaseTransaction(async (tx, executor) => {
    const [job] = await tx
      .select({
        id: articleGenerationJobs.id,
        organizationId: articleGenerationJobs.organizationId,
      })
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.id, input.jobId),
          eq(articleGenerationJobs.organizationId, input.organizationId),
          eq(articleGenerationJobs.status, "queued"),
          isNull(articleGenerationJobs.executionId),
          or(
            isNotNull(articleGenerationJobs.answerbitArticleId),
            isNull(articleGenerationJobs.createDispatchedAt),
          ),
          input.expectedQueueJobId === null
            ? isNull(articleGenerationJobs.queueJobId)
            : eq(articleGenerationJobs.queueJobId, input.expectedQueueJobId),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return false;
    return enqueueLockedArticleJob(tx, executor, job, enqueue);
  });
}

// @project-doc docs/domains/geo_operations.md#article_jobs
export function recoverArticleJob(
  input: {
    organizationId: string;
    jobId: string;
    expectedQueueJobId: string | null;
    expectedExecutionId: string | null;
    status: "queued" | "running";
    staleBefore: Date;
    queueState: QueueJobState | null;
  },
  enqueue: EnqueueArticleJob,
) {
  return withDatabaseTransaction(async (tx, executor) => {
    const [job] = await tx
      .select()
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.id, input.jobId),
          eq(articleGenerationJobs.organizationId, input.organizationId),
          eq(articleGenerationJobs.status, input.status),
          input.expectedQueueJobId === null
            ? isNull(articleGenerationJobs.queueJobId)
            : eq(articleGenerationJobs.queueJobId, input.expectedQueueJobId),
          input.expectedExecutionId === null
            ? isNull(articleGenerationJobs.executionId)
            : eq(articleGenerationJobs.executionId, input.expectedExecutionId),
          lte(articleGenerationJobs.updatedAt, input.staleBefore),
        ),
      )
      .for("update");
    if (!job) return "superseded" as const;
    const action = decideAsyncJobRecovery({
      kind: "article",
      status: input.status,
      queueState: input.queueState,
      hasExternalId: Boolean(job.answerbitArticleId),
      hasCreateDispatched: Boolean(job.createDispatchedAt),
    });
    if (action === "none") return action;
    if (action === "fail_uncertain") {
      await refundArticleCharge(tx, job);
      await tx
        .update(articleGenerationJobs)
        .set({
          status: "failed",
          executionId: null,
          errorCode: "ARTICLE_RECOVERY_UNCERTAIN",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(articleGenerationJobs.id, job.id));
      return action;
    }
    await tx
      .update(articleGenerationJobs)
      .set({
        status: "queued",
        executionId: null,
        ...(job.answerbitArticleId ? {} : { startedAt: null }),
        completedAt: null,
        errorCode: null,
      })
      .where(eq(articleGenerationJobs.id, job.id));
    await enqueueLockedArticleJob(tx, executor, job, enqueue);
    return action;
  });
}

// @project-doc docs/domains/geo_operations.md#article_jobs
export function scheduleArticleResultPoll(
  input: { organizationId: string; jobId: string; executionId: string },
  enqueue: EnqueueArticleJob,
) {
  return withDatabaseTransaction(async (tx, executor) => {
    const [job] = await tx
      .select({
        id: articleGenerationJobs.id,
        organizationId: articleGenerationJobs.organizationId,
      })
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.id, input.jobId),
          eq(articleGenerationJobs.organizationId, input.organizationId),
          eq(articleGenerationJobs.status, "running"),
          eq(articleGenerationJobs.executionId, input.executionId),
          isNotNull(articleGenerationJobs.answerbitArticleId),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return false;
    return enqueueLockedArticleJob(tx, executor, job, enqueue);
  });
}
