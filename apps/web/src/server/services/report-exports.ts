import {
  createReportExportSchema,
  reportExportFiltersSchema,
  type CreateReportExportInput,
  type ReportExportListQuery,
} from "@geo/contracts";
import type { AuditContext } from "@/server/audit/write-audit";
import { ApiError } from "@/server/http/errors";
import { prepareReportExportQueue } from "@/server/jobs/boss";
import { authorizeBrand } from "@/server/permissions/brand-scope";
import { reportExportRepository } from "@/server/repositories/report-exports";
const reportErrors: Record<string, string> = {
  QUOTA_EXHAUSTED: "本周期报表导出额度已用完，请联系管理员。",
  ENTITLEMENT_NOT_FOUND: "当前企业未开通报表导出功能，请联系管理员。",
  RESERVATION_ALREADY_SETTLED: "原任务额度已结算，请重新导出。",
  QUOTA_IDEMPOTENCY_CONFLICT: "任务额度记录不一致，请联系管理员后重新导出。",
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
  now = new Date(),
) => {
  const { fileContent: _, ...record } = row;
  void _;
  const status =
    record.status === "succeeded" && record.expiresAt && record.expiresAt <= now
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
      status === "succeeded" && record.expiresAt && record.expiresAt > now
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
      if (
        existing.status !== "queued" ||
        (existing.quotaReservationKey && existing.queueJobId)
      )
        return { ...present(existing, input.organizationId), replayed: true };
    }
    const enqueue = await prepareReportExportQueue();
    const result = await reportExportRepository.create(
      input,
      idempotencyKey,
      userId,
      {
        validateReplay: (row) => assertReplay(row, input, userId),
        enqueue,
        audit: {
          context: audit,
          input: {
            operation: "report-export.create",
            resourceType: "report_export",
            summary: `创建 ${input.reportType} 报表导出任务`,
          },
        },
      },
    );
    if (!result.ok)
      throw new ApiError(
        result.code === "RESERVATION_ALREADY_SETTLED" ||
          result.code === "QUOTA_IDEMPOTENCY_CONFLICT"
          ? 409
          : 402,
        result.code,
        result.code === "QUOTA_EXHAUSTED"
          ? "本周期报表导出额度已用完"
          : result.code === "RESERVATION_ALREADY_SETTLED" ||
              result.code === "QUOTA_IDEMPOTENCY_CONFLICT"
            ? "原任务额度已结算，请使用重新导出创建新任务"
            : "当前企业未开通报表导出功能",
      );
    return {
      ...present(result.job, input.organizationId),
      replayed: result.replayed,
    };
  },
  async list(input: ReportExportListQuery, userId: string) {
    await authorizeBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
      userId,
      "report.export",
    );
    const { asOf, ...result } = await reportExportRepository.page(
      input,
      userId,
    );
    return {
      ...result,
      list: result.list.map((row) => present(row, input.organizationId, asOf)),
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
