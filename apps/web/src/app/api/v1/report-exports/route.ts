import {
  createReportExportSchema,
  idempotencyKeySchema,
  reportExportListQuerySchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { reportExportService } from "@/server/services/report-exports";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = reportExportListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "导出任务查询参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await reportExportService.list(parsed.data, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = createReportExportSchema.safeParse(
      await readJsonBody(request),
    );
    const key = idempotencyKeySchema.safeParse(
      request.headers.get("Idempotency-Key"),
    );
    if (!parsed.success || !key.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        key.success ? "导出任务参数有误" : "Idempotency-Key 缺失或格式错误",
        parsed.success ? undefined : parsed.error.issues,
      );
    const row = await reportExportService.create(
      parsed.data,
      key.data,
      user.id,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return apiJson(
      { data: row, requestId },
      {
        status: row.replayed ? 200 : 201,
        headers: { Location: `/api/v1/report-exports/${row.id}` },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
