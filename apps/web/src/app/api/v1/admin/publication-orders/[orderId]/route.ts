import {
  publicationOrderIdSchema,
  updatePublicationOrderSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { publicationService } from "@/server/services/publications";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
type Context = { params: Promise<{ orderId: string }> };
export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = publicationOrderIdSchema.safeParse(await context.params);
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "订单编号有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await publicationService.adminOrder(parsed.data.orderId, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const params = publicationOrderIdSchema.safeParse(await context.params);
    if (!params.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "订单编号有误",
        params.error.issues,
      );
    const { orderId } = params.data;
    const parsed = updatePublicationOrderSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布订单处理参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await publicationService.updateOrder(
        orderId,
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
