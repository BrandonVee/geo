import { appealPublicationOrderSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { publicationService } from "@/server/services/publications";
import { apiJson } from "@/server/http/response";

type Context = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { orderId } = await context.params;
    const parsed = appealPublicationOrderSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布申诉参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await publicationService.appeal(
        orderId,
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
