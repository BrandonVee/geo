import { and, desc, eq, sql } from "drizzle-orm";
import {
  answerbitArticleMappings,
  articleGenerationJobs,
  db,
  withDatabaseTransaction,
  type SqlExecutor,
} from "@geo/db";
import {
  writeAudit,
  type AuditContext,
  type AuditEntry,
} from "@/server/audit/write-audit";
type Scope = { organizationId: string; teamBindingId: string; brandId: string };
export const articleRepository = {
  async findMapping(scope: Scope, articleId: string) {
    const [record] = await db
      .select()
      .from(answerbitArticleMappings)
      .where(
        and(
          eq(answerbitArticleMappings.organizationId, scope.organizationId),
          eq(answerbitArticleMappings.teamBindingId, scope.teamBindingId),
          eq(answerbitArticleMappings.brandId, scope.brandId),
          eq(answerbitArticleMappings.articleId, articleId),
        ),
      )
      .limit(1);
    return record;
  },
  async sync(
    scope: Scope,
    articles: {
      id: string;
      title: string;
      status: number;
      source: number;
      template_type: number;
      ref_count: number;
    }[],
  ) {
    const now = new Date();
    for (const item of articles)
      await db
        .insert(answerbitArticleMappings)
        .values({
          ...scope,
          articleId: item.id,
          title: item.title,
          status: item.status,
          source: item.source,
          templateType: item.template_type,
          referenceCount: item.ref_count,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            answerbitArticleMappings.organizationId,
            answerbitArticleMappings.teamBindingId,
            answerbitArticleMappings.brandId,
            answerbitArticleMappings.articleId,
          ],
          set: {
            title: item.title,
            status: item.status,
            source: item.source,
            templateType: item.template_type,
            referenceCount: item.ref_count,
            syncedAt: now,
            updatedAt: now,
          },
        });
  },
  async save(
    scope: Scope,
    value: {
      articleId: string;
      title: string;
      status: number;
      source: number;
      templateType: number;
      referenceCount?: number;
      language?: string;
    },
  ) {
    const [record] = await db
      .insert(answerbitArticleMappings)
      .values({ ...scope, ...value })
      .onConflictDoUpdate({
        target: [
          answerbitArticleMappings.organizationId,
          answerbitArticleMappings.teamBindingId,
          answerbitArticleMappings.brandId,
          answerbitArticleMappings.articleId,
        ],
        set: {
          title: value.title,
          status: value.status,
          source: value.source,
          templateType: value.templateType,
          referenceCount: value.referenceCount ?? 0,
          language: value.language,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return record;
  },
  async findJobByIdempotency(organizationId: string, idempotencyKey: string) {
    const [job] = await db
      .select()
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.organizationId, organizationId),
          eq(articleGenerationJobs.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return job;
  },
  // @project-doc docs/domains/geo_operations.md#article_jobs
  submitJob(
    values: typeof articleGenerationJobs.$inferInsert,
    options: {
      validateReplay: (job: typeof articleGenerationJobs.$inferSelect) => void;
      enqueue: (
        data: { organizationId: string; jobId: string },
        executor: SqlExecutor,
      ) => Promise<string>;
      audit: { context: AuditContext; input: AuditEntry };
    },
  ) {
    return withDatabaseTransaction(async (tx, executor) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${values.organizationId}), hashtext(${values.idempotencyKey}))`,
      );
      const [existing] = await tx
        .select()
        .from(articleGenerationJobs)
        .where(
          and(
            eq(articleGenerationJobs.organizationId, values.organizationId),
            eq(articleGenerationJobs.idempotencyKey, values.idempotencyKey),
          ),
        )
        .limit(1)
        .for("update");
      if (existing) {
        options.validateReplay(existing);
        if (
          existing.status !== "queued" ||
          existing.queueJobId ||
          existing.executionId ||
          existing.answerbitArticleId
        )
          return { job: existing, replayed: true };
      }
      const [inserted] = existing
        ? [existing]
        : await tx.insert(articleGenerationJobs).values(values).returning();
      const queueJobId = await options.enqueue(
        { organizationId: inserted!.organizationId, jobId: inserted!.id },
        executor,
      );
      const [job] = await tx
        .update(articleGenerationJobs)
        .set({ queueJobId, errorCode: null, updatedAt: new Date() })
        .where(eq(articleGenerationJobs.id, inserted!.id))
        .returning();
      await writeAudit(
        { ...options.audit.context, organizationId: values.organizationId },
        {
          ...options.audit.input,
          ...(existing
            ? {
                operation: "answerbit.article.submission.recover",
                summary: "恢复未入队的文章生成任务",
              }
            : {}),
          resourceId: job!.id,
        },
        tx,
      );
      return { job: job!, replayed: Boolean(existing) };
    });
  },
  async findJob(scope: Scope, jobId: string) {
    const [job] = await db
      .select()
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.id, jobId),
          eq(articleGenerationJobs.organizationId, scope.organizationId),
          eq(articleGenerationJobs.teamBindingId, scope.teamBindingId),
          eq(articleGenerationJobs.brandId, scope.brandId),
        ),
      )
      .limit(1);
    return job;
  },
  async cancelQueuedJob(scope: Scope, jobId: string) {
    const [job] = await db
      .update(articleGenerationJobs)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(articleGenerationJobs.id, jobId),
          eq(articleGenerationJobs.organizationId, scope.organizationId),
          eq(articleGenerationJobs.teamBindingId, scope.teamBindingId),
          eq(articleGenerationJobs.brandId, scope.brandId),
          eq(articleGenerationJobs.status, "queued"),
        ),
      )
      .returning();
    return job;
  },
  listJobs(scope: Scope, limit: number) {
    return db
      .select()
      .from(articleGenerationJobs)
      .where(
        and(
          eq(articleGenerationJobs.organizationId, scope.organizationId),
          eq(articleGenerationJobs.teamBindingId, scope.teamBindingId),
          eq(articleGenerationJobs.brandId, scope.brandId),
        ),
      )
      .orderBy(desc(articleGenerationJobs.createdAt))
      .limit(limit);
  },
};
