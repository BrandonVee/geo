import { publicationOrderIdSchema } from "@geo/contracts";
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
    if (!params.success)
      throw new ApiError(400, "VALIDATION_ERROR", "订单编号有误");
    return apiJson({
      data: await publicationService.adminManuscript(
        params.data.orderId,
        user.id,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
