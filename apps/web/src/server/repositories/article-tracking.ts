import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  completeTrackingSubmission,
  articleTrackingSubmissions as submissions,
  consumeBalance,
  db,
} from "@geo/db";
import { writeAudit, type AuditContext } from "@/server/audit/write-audit";

type Record = typeof submissions.$inferSelect;
type Scope = Pick<Record, "organizationId" | "teamBindingId" | "brandId">;
export const trackingRepository = {
  // @project-doc docs/domains/geo_operations.md#article_tracking
  begin(
    values: Omit<typeof submissions.$inferInsert, "points">,
    audit: AuditContext,
    validateNew: () => Promise<number>,
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${values.organizationId}), hashtext(${values.idempotencyKey}))`,
      );
      const [existing] = await tx
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.organizationId, values.organizationId),
            eq(submissions.idempotencyKey, values.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (
          existing.requestedBy !== values.requestedBy ||
          existing.teamBindingId !== values.teamBindingId ||
          existing.brandId !== values.brandId ||
          existing.requestFingerprint !== values.requestFingerprint
        )
          throw new Error("ARTICLE_TRACKING_IDEMPOTENCY_CONFLICT");
        return { record: existing, replayed: true };
      }
      const points = await validateNew();
      const [record] = await tx
        .insert(submissions)
        .values({ ...values, points })
        .returning();
      const consumed = await consumeBalance(
        {
          organizationId: record!.organizationId,
          brandId: record!.brandId,
          asset: "answerbit_points",
          amount: points,
          referenceType: "feature_usage",
          referenceId: record!.id,
          idempotencyKey: `feature:effect_tracking:${record!.id}:consume`,
          reason: "效果追踪链接功能计费",
          actorUserId: record!.requestedBy,
        },
        tx,
      );
      if (!consumed.ok) throw new Error("ANSWERBIT_POINTS_INSUFFICIENT");
      await writeAudit(
        audit,
        {
          operation: "answerbit.article.trace.submit",
          resourceType: "article_tracking_submission",
          resourceId: record!.id,
          summary: "提交公开文章效果追踪",
        },
        tx,
      );
      return { record: record!, replayed: false };
    });
  },
  async rememberArticle(id: string, articleId: string) {
    const [record] = await db
      .update(submissions)
      .set({ articleId, updatedAt: new Date() })
      .where(and(eq(submissions.id, id), isNull(submissions.articleId)))
      .returning();
    if (!record) throw new Error("ARTICLE_TRACKING_RESULT_CONFLICT");
    return record;
  },
  complete(
    id: string,
    input: { title: string; language: string },
    audit: AuditContext,
  ) {
    return completeTrackingSubmission(id, input, (record, tx) =>
      writeAudit(
        audit,
        {
          operation: "answerbit.article.trace",
          resourceType: "answerbit_article",
          resourceId: record.articleId!,
          summary: `创建效果追踪 ${input.title}`,
        },
        tx,
      ),
    );
  },
  list(scope: Scope, userId: string) {
    return db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.organizationId, scope.organizationId),
          eq(submissions.teamBindingId, scope.teamBindingId),
          eq(submissions.brandId, scope.brandId),
          eq(submissions.requestedBy, userId),
        ),
      )
      .orderBy(desc(submissions.createdAt))
      .limit(20);
  },
};
