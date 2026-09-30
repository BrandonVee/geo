import { articleTrackingQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { ApiError, errorResponse } from "@/server/http/errors";
import { apiJson } from "@/server/http/response";
import { articleTrackingService } from "@/server/services/article-tracking";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = articleTrackingQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询范围有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await articleTrackingService.list(
        parsed.data,
        user.id,
        auditContextFromRequest(
          request,
          parsed.data.organizationId,
          user.id,
          requestId,
        ),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
