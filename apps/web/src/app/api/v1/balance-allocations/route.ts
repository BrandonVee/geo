import { allocateBrandBalanceSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { balanceService } from "@/server/services/balances";
import { apiJson } from "@/server/http/response";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = allocateBrandBalanceSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "品牌余额划分参数有误",
        parsed.error.issues,
      );
    const data = await balanceService.allocate(
      parsed.data,
      user.id,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return apiJson({ data, requestId }, { status: data.replayed ? 200 : 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
