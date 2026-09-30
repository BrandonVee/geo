import {
  createReportExportSchema,
  reportExportFiltersSchema,
  type CreateReportExportInput,
  type ReportExportListQuery,
} from "@geo/contracts";
import { reserveQuota, releaseQuota } from "@geo/db";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { enqueueReportExport } from "@/server/jobs/boss";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { reportExportRepository } from "@/server/repositories/report-exports";
const reportErrors: Record<string, string> = {
  REPORT_PERMISSION_REVOKED: "操作权限已变更，请联系企业管理员。",
  ORGANIZATION_FEATURE_DISABLED: "报告功能已关闭，请联系平台管理员。",
  ORGANIZATION_EXPIRED: "企业服务已到期，请续期后重新导出。",
  ORGANIZATION_SUSPENDED: "企业已被冻结或关闭，请联系平台管理员。",
  BRAND_NOT_FOUND: "品牌授权范围已变更，请联系企业管理员。",
  INVALID_REPORT_EXPORT_FILTERS: "原筛选条件已失效，请重新选择条件导出。",
  REPORT_EXPORT_TOO_LARGE: "报告数据量过大，请缩小日期或筛选范围后重试。",
  TEAM_BINDING_NOT_FOUND: "企业接入不可用，请联系平台管理员。",
};
const present = <
  Row extends {
    id: string;
    status: string;
    expiresAt: Date | null;
    errorCode: string | null;
    filters: unknown;
    fileContent?: string | null;
  },
>(
  row: Row,
  organizationId: string,
) => {
  const { fileContent: _, ...record } = row;
  void _;
  const status =
    record.status === "succeeded" &&
    record.expiresAt &&
    record.expiresAt <= new Date()
      ? "expired"
      : record.status;
  const parsedFilters = reportExportFiltersSchema.safeParse(record.filters);
  return {
    ...record,
    status,
    filters: parsedFilters.success ? parsedFilters.data : null,
    errorMessage:
      status === "failed"
        ? (reportErrors[record.errorCode ?? ""] ??
          "报告生成失败，可重新导出；多次失败请联系管理员。")
        : null,
    downloadUrl:
      status === "succeeded" &&
      record.expiresAt &&
      record.expiresAt > new Date()
        ? `/api/v1/report-exports/${record.id}/file?organizationId=${organizationId}`
        : null,
  };
};
// @project-doc docs/domains/geo_operations.md#report_exports
function assertReplay(
  row: NonNullable<Awaited<ReturnType<typeof reportExportRepository.find>>>,
  input: CreateReportExportInput,
  userId: string,
) {
  const stored = createReportExportSchema.safeParse({
    ...row.filters,
    organizationId: row.organizationId,
    teamBindingId: row.teamBindingId,
    brandId: row.brandId,
    reportType: row.reportType,
  });
  const requested = createReportExportSchema.safeParse(input);
  if (
    row.requestedBy !== userId ||
    !stored.success ||
    !requested.success ||
    JSON.stringify(stored.data) !== JSON.stringify(requested.data)
  )
    throw new ApiError(
      409,
      "REPORT_EXPORT_IDEMPOTENCY_CONFLICT",
      "同一幂等键的导出范围、筛选条件或操作用户不一致，请重新提交",
    );
}
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
    if (existing) {
      assertReplay(existing, input, userId);
      return { ...present(existing, input.organizationId), replayed: true };
    }
    let job;
    try {
      job = await reportExportRepository.create(input, idempotencyKey, userId);
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        const duplicate = await reportExportRepository.findByIdempotency(
          input.organizationId,
          idempotencyKey,
        );
        if (duplicate) {
          assertReplay(duplicate, input, userId);
          return {
            ...present(duplicate, input.organizationId),
            replayed: true,
          };
        }
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
    return { ...present(stored, input.organizationId), replayed: false };
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
      list: list.map((row) => present(row, input.organizationId)),
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
    return present(row, organizationId);
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
