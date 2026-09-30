import { and, eq, isNull, isNotNull } from "drizzle-orm";
import {
  withDatabaseTransaction,
  type DatabaseTransaction,
  type SqlExecutor,
} from "./context";
import { articleGenerationJobs } from "./schema";

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
