import { taskListQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { insightService } from "@/server/services/insights";
import { apiJson } from "@/server/http/response";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = taskListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "回答筛选参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await insightService.tasks(parsed.data, user.id, requestId),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
