import { publicationChannelQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { publicationService } from "@/server/services/publications";
import { apiJson } from "@/server/http/response";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = publicationChannelQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布渠道查询参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await publicationService.channels(parsed.data, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
