import { and, eq, isNull } from "drizzle-orm";
import { db } from "./client";
import { reserveQuotaInTransaction } from "./billing";
import { withDatabaseTransaction, type SqlExecutor } from "./context";
import { reportExports } from "./schema";

// @project-doc docs/domains/geo_operations.md#report_exports
export function claimReportExport(
  input: { organizationId: string; exportId: string },
  executionId: string,
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(reportExports)
      .where(
        and(
          eq(reportExports.id, input.exportId),
          eq(reportExports.organizationId, input.organizationId),
          eq(reportExports.status, "queued"),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return undefined;
    const reservationKey = `report:${job.id}:reserve`;
    const quota = await reserveQuotaInTransaction(tx, {
      organizationId: job.organizationId,
      entitlementKey: "report_exports",
      amount: 1,
      reference: { type: "report_export", id: job.id },
      idempotencyKey: reservationKey,
      actorUserId: job.requestedBy,
    });
    if (!quota.ok) {
      await tx
        .update(reportExports)
        .set({
          status: "failed",
          quotaReservationKey: null,
          errorCode: quota.code,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(reportExports.id, job.id));
      return undefined;
    }
    const [claimed] = await tx
      .update(reportExports)
      .set({
        status: "running",
        executionId,
        quotaReservationKey: reservationKey,
        startedAt: new Date(),
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(reportExports.id, job.id))
      .returning();
    return claimed;
  });
}

// @project-doc docs/domains/geo_operations.md#report_exports
export function redeliverReportExport(
  input: {
    organizationId: string;
    exportId: string;
    expectedQueueJobId: string | null;
  },
  enqueue: (
    data: { organizationId: string; exportId: string },
    executor: SqlExecutor,
  ) => Promise<string>,
) {
  return withDatabaseTransaction(async (tx, executor) => {
    const [job] = await tx
      .select()
      .from(reportExports)
      .where(
        and(
          eq(reportExports.id, input.exportId),
          eq(reportExports.organizationId, input.organizationId),
          eq(reportExports.status, "queued"),
          isNull(reportExports.executionId),
          input.expectedQueueJobId === null
            ? isNull(reportExports.queueJobId)
            : eq(reportExports.queueJobId, input.expectedQueueJobId),
        ),
      )
      .limit(1)
      .for("update");
    if (!job) return false;
    const reservationKey = `report:${job.id}:reserve`;
    const quota = await reserveQuotaInTransaction(tx, {
      organizationId: job.organizationId,
      entitlementKey: "report_exports",
      amount: 1,
      reference: { type: "report_export", id: job.id },
      idempotencyKey: reservationKey,
      actorUserId: job.requestedBy,
    });
    if (!quota.ok) {
      await tx
        .update(reportExports)
        .set({
          status: "failed",
          quotaReservationKey: null,
          errorCode: quota.code,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(reportExports.id, job.id));
      return false;
    }
    const queueJobId = await enqueue(
      { organizationId: job.organizationId, exportId: job.id },
      executor,
    );
    await tx
      .update(reportExports)
      .set({
        quotaReservationKey: reservationKey,
        queueJobId,
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(reportExports.id, job.id));
    return true;
  });
}
