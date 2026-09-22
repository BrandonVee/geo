import { featurePointCostSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { balanceService } from "@/server/services/balances";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await balanceService.pointCosts(user.id),
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
    const parsed = featurePointCostSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "功能积分规则参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await balanceService.setPointCost(
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
