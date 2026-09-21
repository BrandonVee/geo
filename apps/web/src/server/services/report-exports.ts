import type {
  CreateReportExportInput,
  ReportExportListQuery,
} from "@geo/contracts";
import { reserveQuota, releaseQuota } from "@geo/db";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { enqueueReportExport } from "@/server/jobs/boss";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { reportExportRepository } from "@/server/repositories/report-exports";
const present = (
  row: NonNullable<Awaited<ReturnType<typeof reportExportRepository.find>>>,
) => {
  const { fileContent: _, ...record } = row;
  void _;
  return {
    ...record,
    downloadUrl:
      record.status === "succeeded" &&
      record.expiresAt &&
      record.expiresAt > new Date()
        ? `/api/v1/report-exports/${record.id}/file?organizationId=${record.organizationId}`
        : null,
  };
};
export const reportExportService = {
  async create(
    input: CreateReportExportInput,
    idempotencyKey: string,
    userId: string,
    audit: AuditContext,
  ) {
    await authorizeBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "report.export",
    );
    const existing = await reportExportRepository.findByIdempotency(
      input.organizationId,
      idempotencyKey,
    );
    if (existing) return { ...present(existing), replayed: true };
    let job;
    try {
      job = await reportExportRepository.create(input, idempotencyKey, userId);
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        const duplicate = await reportExportRepository.findByIdempotency(
          input.organizationId,
          idempotencyKey,
        );
        if (duplicate) return { ...present(duplicate), replayed: true };
      }
      throw error;
    }
    const reservationKey = `report:${job.id}:reserve`;
    const quota = await reserveQuota({
      organizationId: input.organizationId,
      entitlementKey: "report_exports",
      amount: 1,
      reference: { type: "report_export", id: job.id },
      idempotencyKey: reservationKey,
      actorUserId: userId,
    });
    if (!quota.ok) {
      await reportExportRepository.remove(job.id);
      throw new ApiError(
        402,
        quota.code,
        quota.code === "QUOTA_EXHAUSTED"
          ? "本周期报表导出额度已用完"
          : "当前企业未开通报表导出功能",
      );
    }
    await reportExportRepository.setReservation(job.id, reservationKey);
    try {
      const queueJobId = await enqueueReportExport({
        organizationId: input.organizationId,
        exportId: job.id,
      });
      await reportExportRepository.setQueueJobId(job.id, queueJobId);
    } catch (error) {
      await releaseQuota(input.organizationId, reservationKey);
      await reportExportRepository.remove(job.id);
      throw error;
    }
    const stored = (await reportExportRepository.find(
      job.id,
      input.organizationId,
    ))!;
    await writeAudit(audit, {
      operation: "report-export.create",
      resourceType: "report_export",
      resourceId: job.id,
      summary: `创建 ${input.reportType} 报表导出任务`,
    });
    return { ...present(stored), replayed: false };
  },
  async list(input: ReportExportListQuery, userId: string) {
    await authorizeBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "report.export",
    );
    const [list, total] = await Promise.all([
      reportExportRepository.list(input),
      reportExportRepository.count(input),
    ]);
    return {
      list: list.map((row) => ({
        ...row,
        downloadUrl:
          row.status === "succeeded" &&
          row.expiresAt &&
          row.expiresAt > new Date()
            ? `/api/v1/report-exports/${row.id}/file?organizationId=${input.organizationId}`
            : null,
      })),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        pages: Math.ceil(total / input.pageSize),
      },
    };
  },
  async get(id: string, organizationId: string, userId: string) {
    const row = await reportExportRepository.find(id, organizationId);
    if (!row)
      throw new ApiError(404, "REPORT_EXPORT_NOT_FOUND", "导出任务不存在");
    await authorizeBrand(
      row.organizationId,
      row.teamBindingId,
      row.brandId,
      userId,
      "report.export",
    );
    return present(row);
  },
  async file(id: string, organizationId: string, userId: string) {
    const row = await reportExportRepository.find(id, organizationId);
    if (!row)
      throw new ApiError(404, "REPORT_EXPORT_NOT_FOUND", "导出任务不存在");
    await authorizeBrand(
      row.organizationId,
      row.teamBindingId,
      row.brandId,
      userId,
      "report.export",
    );
    if (
      row.status === "expired" ||
      (row.expiresAt && row.expiresAt <= new Date())
    )
      throw new ApiError(410, "REPORT_EXPORT_EXPIRED", "导出文件已过期");
    const { fileContent, filename, mimeType } = row;
    if (row.status !== "succeeded" || !fileContent || !filename || !mimeType)
      throw new ApiError(409, "REPORT_EXPORT_NOT_READY", "导出文件尚未生成");
    return { fileContent, filename, mimeType };
  },
};
