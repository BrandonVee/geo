import {
  publicationOrderIdSchema,
  resolvePublicationActionSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { publicationService } from "@/server/services/publications";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

export async function POST(
  request: Request,
  context: { params: Promise<{ orderId: string }> },
) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const path = publicationOrderIdSchema.safeParse(await context.params);
    const parsed = resolvePublicationActionSchema.safeParse(
      await readJsonBody(request),
    );
    if (!path.success || !parsed.success)
      throw new ApiError(400, "VALIDATION_ERROR", "订单核对参数有误");
    return apiJson({
      data: await publicationService.resolveAction(
        path.data.orderId,
        parsed.data,
        user.id,
        auditContextFromRequest(
          request,
          parsed.data.organizationId,
          user.id,
          requestId,
        ),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
