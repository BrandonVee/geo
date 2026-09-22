import {
  createSavedViewSchema,
  savedViewListQuerySchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { savedViewService } from "@/server/services/saved-views";
import { apiJson } from "@/server/http/response";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = savedViewListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "保存视图查询参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await savedViewService.list(
        parsed.data.organizationId,
        parsed.data.page,
        user.id,
      ),
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
    const parsed = createSavedViewSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "保存视图参数有误",
        parsed.error.issues,
      );
    const row = await savedViewService.create(
      parsed.data,
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
      { status: 201, headers: { Location: `/api/v1/saved-views/${row.id}` } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
