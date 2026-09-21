import type {
  CreateReportExportInput,
  ReportExportListQuery,
} from "@geo/contracts";
import { db, reportExports } from "@geo/db";
import { and, desc, eq, sql } from "drizzle-orm";
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
  create(
    input: CreateReportExportInput,
    idempotencyKey: string,
    userId: string,
  ) {
    const { organizationId, teamBindingId, brandId, reportType, ...filters } =
      input;
    return db
      .insert(reportExports)
      .values({
        organizationId,
        teamBindingId,
        brandId,
        reportType,
        filters,
        idempotencyKey,
        requestedBy: userId,
      })
      .returning()
      .then((rows) => rows[0]!);
  },
  setReservation(id: string, quotaReservationKey: string) {
    return db
      .update(reportExports)
      .set({ quotaReservationKey, updatedAt: new Date() })
      .where(eq(reportExports.id, id));
  },
  setQueueJobId(id: string, queueJobId: string) {
    return db
      .update(reportExports)
      .set({ queueJobId, updatedAt: new Date() })
      .where(eq(reportExports.id, id));
  },
  remove(id: string) {
    return db.delete(reportExports).where(eq(reportExports.id, id));
  },
  list(input: ReportExportListQuery) {
    return db
      .select({
        id: reportExports.id,
        reportType: reportExports.reportType,
        status: reportExports.status,
        filename: reportExports.filename,
        rowCount: reportExports.rowCount,
        errorCode: reportExports.errorCode,
        createdAt: reportExports.createdAt,
        completedAt: reportExports.completedAt,
        expiresAt: reportExports.expiresAt,
      })
      .from(reportExports)
      .where(
        and(
          eq(reportExports.organizationId, input.organizationId),
          eq(reportExports.teamBindingId, input.teamBindingId),
          eq(reportExports.brandId, input.brandId),
        ),
      )
      .orderBy(desc(reportExports.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize);
  },
  async count(input: ReportExportListQuery) {
    const [row] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(reportExports)
      .where(
        and(
          eq(reportExports.organizationId, input.organizationId),
          eq(reportExports.teamBindingId, input.teamBindingId),
          eq(reportExports.brandId, input.brandId),
        ),
      );
    return row?.value ?? 0;
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
