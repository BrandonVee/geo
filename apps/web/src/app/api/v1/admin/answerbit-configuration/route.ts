import { adminSetAnswerBitCredentialSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { platformAnswerbitService } from "@/server/services/platform-answerbit";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request, {
      allowBeforeTencentConnection: true,
    });
    return Response.json({
      data: await platformAnswerbitService.get(user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PUT(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request, {
      allowBeforeTencentConnection: true,
    });
    const parsed = adminSetAnswerBitCredentialSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "统一腾讯接入参数有误",
        parsed.error.issues,
      );
    return Response.json({
      data: await platformAnswerbitService.configure(
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
