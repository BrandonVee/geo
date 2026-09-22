import { pointUsageQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { balanceService } from "@/server/services/balances";
import { apiJson } from "@/server/http/response";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = pointUsageQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "积分用量查询参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await balanceService.pointUsage(parsed.data, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
