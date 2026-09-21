import { and, desc, eq } from "drizzle-orm";
import { answerbitArticleMappings, articleGenerationJobs, db } from "@geo/db";
type Scope = { organizationId: string; teamBindingId: string; brandId: string };
export const articleRepository = {
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
  async createJob(values: typeof articleGenerationJobs.$inferInsert) {
    const [job] = await db
      .insert(articleGenerationJobs)
      .values(values)
      .returning();
    return job;
  },
  async updateJob(
    jobId: string,
    changes: Partial<typeof articleGenerationJobs.$inferInsert>,
  ) {
    const [job] = await db
      .update(articleGenerationJobs)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(articleGenerationJobs.id, jobId))
      .returning();
    return job;
  },
  async deleteJob(jobId: string) {
    await db
      .delete(articleGenerationJobs)
      .where(eq(articleGenerationJobs.id, jobId));
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
