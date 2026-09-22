import { pricingTierRuleSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { pricingService } from "@/server/services/pricing";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await pricingService.list(user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PUT(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = pricingTierRuleSchema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "价格等级规则参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await pricingService.update(
        parsed.data,
        user.id,
        auditContextFromRequest(request, undefined, user.id, requestId),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
