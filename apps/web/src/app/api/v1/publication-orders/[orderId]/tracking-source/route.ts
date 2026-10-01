import { publicationTrackingSourceQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { apiJson } from "@/server/http/response";
import { publicationService } from "@/server/services/publications";

export async function GET(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const params = await context.params;
    const parsed = publicationTrackingSourceQuerySchema.safeParse({
      ...Object.fromEntries(new URL(request.url).searchParams),
      orderId: params.orderId,
    });
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布追踪来源参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await publicationService.trackingSource(
        parsed.data.orderId,
        parsed.data,
        user.id,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
