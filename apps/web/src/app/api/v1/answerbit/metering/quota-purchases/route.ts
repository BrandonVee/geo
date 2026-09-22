import { purchaseAnswerBitQuotaSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { meteringService } from "@/server/services/metering";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = purchaseAnswerBitQuotaSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "监控品牌扩容参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await meteringService.purchaseQuota(
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
