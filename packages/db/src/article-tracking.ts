import { and, eq, isNull, isNotNull, inArray, lt } from "drizzle-orm";
import { db } from "./client";
import { restoreBalance } from "./balances";
import {
  answerbitArticleMappings,
  articleTrackingSubmissions,
  operationLogs,
} from "./schema";
import type { DatabaseTransaction } from "./context";

type TrackingRecord = typeof articleTrackingSubmissions.$inferSelect;
export function completeTrackingSubmission(
  id: string,
  input: { title: string; language: string },
  audit?: (record: TrackingRecord, tx: DatabaseTransaction) => Promise<void>,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(articleTrackingSubmissions)
      .where(eq(articleTrackingSubmissions.id, id))
      .for("update")
      .limit(1);
    if (!record?.articleId) throw new Error("ARTICLE_TRACKING_RESULT_MISSING");
    if (record.status === "succeeded") return record;
    await tx
      .insert(answerbitArticleMappings)
      .values({
        organizationId: record.organizationId,
        teamBindingId: record.teamBindingId,
        brandId: record.brandId,
        articleId: record.articleId,
        title: input.title,
        language: input.language,
        status: 3,
        source: 2,
        templateType: 0,
      })
      .onConflictDoNothing();
    if (audit) await audit(record, tx);
    else
      await tx.insert(operationLogs).values({
        organizationId: record.organizationId,
        actorUserId: record.requestedBy,
        requestId: record.id,
        operation: "answerbit.article.trace",
        resourceType: "answerbit_article",
        resourceId: record.articleId,
        summary: "后台恢复已成功的效果追踪提交",
        result: "success",
      });
    const [completed] = await tx
      .update(articleTrackingSubmissions)
      .set({ status: "succeeded", errorCode: null, updatedAt: new Date() })
      .where(eq(articleTrackingSubmissions.id, id))
      .returning();
    return completed!;
  });
}

// @project-doc docs/domains/geo_operations.md#article_tracking
export function settleTrackingFailure(
  id: string,
  status: "failed" | "uncertain",
  errorCode: string,
  staleBefore?: Date,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(articleTrackingSubmissions)
      .where(eq(articleTrackingSubmissions.id, id))
      .for("update")
      .limit(1);
    if (
      !current ||
      current.articleId ||
      current.status !== "submitting" ||
      (staleBefore && current.updatedAt >= staleBefore)
    )
      return current;
    if (current.points > 0)
      await restoreBalance(
        {
          organizationId: current.organizationId,
          brandId: current.brandId,
          asset: "answerbit_points",
          amount: current.points,
          referenceType: "feature_usage_failed",
          referenceId: current.id,
          idempotencyKey: `feature:effect_tracking:${current.id}:restore`,
          reason:
            status === "failed"
              ? "效果追踪失败返还"
              : "效果追踪结果待核对，返还积分",
          actorUserId: current.requestedBy,
        },
        tx,
      );
    await tx.insert(operationLogs).values({
      organizationId: current.organizationId,
      actorUserId: current.requestedBy,
      requestId: current.id,
      operation: "answerbit.article.trace.settlement",
      resourceType: "article_tracking_submission",
      resourceId: current.id,
      summary:
        status === "failed"
          ? "效果追踪失败并返还积分"
          : "效果追踪结果待核对并返还积分",
      result: "failed",
    });
    const [record] = await tx
      .update(articleTrackingSubmissions)
      .set({ status, errorCode, refunded: true, updatedAt: new Date() })
      .where(eq(articleTrackingSubmissions.id, id))
      .returning();
    return record;
  });
}

export async function recoverStaleTrackingSubmissions(
  now = new Date(),
  decode?: (record: TrackingRecord) => { title: string; language: string },
) {
  let completed = 0;
  let errors = 0;
  if (decode) {
    const known = await db
      .select()
      .from(articleTrackingSubmissions)
      .where(
        and(
          inArray(articleTrackingSubmissions.status, [
            "submitting",
            "uncertain",
          ]),
          isNotNull(articleTrackingSubmissions.articleId),
        ),
      )
      .limit(100);
    for (const record of known) {
      try {
        await completeTrackingSubmission(record.id, decode(record));
        completed += 1;
      } catch {
        errors += 1;
        console.error(
          JSON.stringify({
            event: "article-tracking.recovery-failed",
            submissionId: record.id,
          }),
        );
      }
    }
  }
  const before = new Date(now.getTime() - 60_000);
  const records = await db
    .select({ id: articleTrackingSubmissions.id })
    .from(articleTrackingSubmissions)
    .where(
      and(
        eq(articleTrackingSubmissions.status, "submitting"),
        isNull(articleTrackingSubmissions.articleId),
        lt(articleTrackingSubmissions.updatedAt, before),
      ),
    )
    .limit(100);
  let recovered = 0;
  for (const record of records) {
    const result = await settleTrackingFailure(
      record.id,
      "uncertain",
      "ARTICLE_TRACKING_INTERRUPTED",
      before,
    );
    if (result?.status === "uncertain") recovered += 1;
  }
  return { recovered, completed, errors };
}
