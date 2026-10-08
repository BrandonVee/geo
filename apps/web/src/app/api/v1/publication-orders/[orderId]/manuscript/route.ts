import {
  publicationManuscriptQuerySchema,
  publicationOrderIdSchema,
} from "@geo/contracts";
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
    const params = publicationOrderIdSchema.safeParse(await context.params);
    const scope = publicationManuscriptQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!params.success || !scope.success)
      throw new ApiError(400, "VALIDATION_ERROR", "稿件查询范围或订单编号有误");
    return apiJson({
      data: await publicationService.manuscript(
        params.data.orderId,
        scope.data,
        user.id,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
