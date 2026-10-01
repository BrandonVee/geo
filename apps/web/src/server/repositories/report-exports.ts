import type {
  CreateReportExportInput,
  ReportExportListQuery,
} from "@geo/contracts";
import { randomUUID } from "node:crypto";
import {
  db,
  reportExports,
  reserveQuotaInTransaction,
  withDatabaseTransaction,
  withTenantDbContext,
  type SqlExecutor,
} from "@geo/db";
import {
  writeAudit,
  type AuditContext,
  type AuditEntry,
} from "@/server/audit/write-audit";
import { and, count, desc, eq, gte, lt, or, ilike, sql } from "drizzle-orm";
export const reportExportRepository = {
  async findByIdempotency(organizationId: string, key: string) {
    const [row] = await db
      .select()
      .from(reportExports)
      .where(
        and(
          eq(reportExports.organizationId, organizationId),
          eq(reportExports.idempotencyKey, key),
        ),
      )
      .limit(1);
    return row;
  },
  // @project-doc docs/domains/geo_operations.md#report_exports
  create(
    input: CreateReportExportInput,
    idempotencyKey: string,
    userId: string,
    options: {
      validateReplay: (row: typeof reportExports.$inferSelect) => void;
      enqueue: (
        data: { organizationId: string; exportId: string },
        executor: SqlExecutor,
      ) => Promise<string>;
      audit: { context: AuditContext; input: AuditEntry };
    },
  ) {
    return withDatabaseTransaction(async (tx, executor) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${idempotencyKey}))`,
      );
      const [existing] = await tx
        .select()
        .from(reportExports)
        .where(
          and(
            eq(reportExports.organizationId, input.organizationId),
            eq(reportExports.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1)
        .for("update");
      if (existing) {
        options.validateReplay(existing);
        if (
          existing.status !== "queued" ||
          (existing.quotaReservationKey && existing.queueJobId)
        )
          return { ok: true as const, job: existing, replayed: true };
      }
      const id = existing?.id ?? randomUUID();
      const reservationKey = `report:${id}:reserve`;
      const quota = await reserveQuotaInTransaction(tx, {
        organizationId: input.organizationId,
        entitlementKey: "report_exports",
        amount: 1,
        reference: { type: "report_export", id },
        idempotencyKey: reservationKey,
        actorUserId: userId,
      });
      if (!quota.ok) {
        if (!existing) return quota;
        const [failed] = await tx
          .update(reportExports)
          .set({
            status: "failed",
            quotaReservationKey: null,
            errorCode: quota.code,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reportExports.id, id))
          .returning();
        await writeAudit(
          { ...options.audit.context, organizationId: input.organizationId },
          {
            operation: "report-export.submission.recover",
            resourceType: "report_export",
            resourceId: id,
            summary: "未完成的报告提交无法恢复",
            result: "failed",
          },
          tx,
        );
        return { ok: true as const, job: failed!, replayed: true };
      }
      const { organizationId, teamBindingId, brandId, reportType, ...filters } =
        input;
      if (!existing)
        await tx.insert(reportExports).values({
          id,
          organizationId,
          teamBindingId,
          brandId,
          reportType,
          filters,
          idempotencyKey,
          requestedBy: userId,
          quotaReservationKey: reservationKey,
        });
      const queueJobId =
        existing?.queueJobId ??
        (await options.enqueue({ organizationId, exportId: id }, executor));
      const [job] = await tx
        .update(reportExports)
        .set({
          quotaReservationKey: reservationKey,
          queueJobId,
          updatedAt: new Date(),
        })
        .where(eq(reportExports.id, id))
        .returning();
      await writeAudit(
        { ...options.audit.context, organizationId },
        {
          ...options.audit.input,
          ...(existing
            ? {
                operation: "report-export.submission.recover",
                summary: "恢复未完成的报告提交",
              }
            : {}),
          resourceId: id,
        },
        tx,
      );
      return { ok: true as const, job: job!, replayed: Boolean(existing) };
    });
  },
  // @project-doc docs/domains/geo_operations.md#report_exports
  page(input: ReportExportListQuery, userId: string) {
    return withTenantDbContext(
      {
        organizationId: input.organizationId,
        userId,
        teamBindingId: input.teamBindingId,
        brandId: input.brandId,
      },
      async (tx) => {
        const now = new Date();
        const effectiveStatus = sql<string>`case when ${reportExports.status} = 'succeeded' and ${reportExports.expiresAt} <= ${now} then 'expired' else ${reportExports.status}::text end`;
        const pattern = `%${input.q.replace(/[\\%_]/g, "\\$&")}%`;
        const where = and(
          eq(reportExports.organizationId, input.organizationId),
          eq(reportExports.teamBindingId, input.teamBindingId),
          eq(reportExports.brandId, input.brandId),
          input.reportType
            ? eq(reportExports.reportType, input.reportType)
            : undefined,
          input.status ? sql`${effectiveStatus} = ${input.status}` : undefined,
          input.beginDate
            ? gte(
                reportExports.createdAt,
                new Date(`${input.beginDate}T00:00:00+08:00`),
              )
            : undefined,
          input.endDate
            ? lt(
                reportExports.createdAt,
                new Date(
                  new Date(`${input.endDate}T00:00:00+08:00`).getTime() +
                    86_400_000,
                ),
              )
            : undefined,
          input.q
            ? or(
                ilike(reportExports.filename, pattern),
                sql`${reportExports.id}::text ilike ${pattern}`,
                sql`coalesce(${reportExports.filters}->>'keyword', '') ilike ${pattern}`,
              )
            : undefined,
        );
        const [total] = await tx
          .select({ value: count() })
          .from(reportExports)
          .where(where);
        const page = Math.min(
          input.page,
          Math.max(1, Math.ceil(total.value / input.pageSize)),
        );
        const list = await tx
          .select({
            id: reportExports.id,
            reportType: reportExports.reportType,
            filters: reportExports.filters,
            status: effectiveStatus.as("effective_status"),
            filename: reportExports.filename,
            rowCount: reportExports.rowCount,
            errorCode: reportExports.errorCode,
            createdAt: reportExports.createdAt,
            completedAt: reportExports.completedAt,
            expiresAt: reportExports.expiresAt,
          })
          .from(reportExports)
          .where(where)
          .orderBy(desc(reportExports.createdAt), desc(reportExports.id))
          .limit(input.pageSize)
          .offset((page - 1) * input.pageSize);
        return {
          asOf: now,
          list,
          pagination: {
            page,
            pageSize: input.pageSize,
            total: total.value,
            pages: Math.ceil(total.value / input.pageSize),
          },
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  async find(id: string, organizationId: string) {
    const [row] = await db
      .select()
      .from(reportExports)
      .where(
        and(
          eq(reportExports.id, id),
          eq(reportExports.organizationId, organizationId),
        ),
      )
      .limit(1);
    return row;
  },
};
