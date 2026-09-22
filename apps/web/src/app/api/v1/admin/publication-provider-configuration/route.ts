import { adminSetFrogCredentialSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { platformFrogService } from "@/server/services/platform-frog";
import { apiJson } from "@/server/http/response";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await platformFrogService.get(user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PUT(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = adminSetFrogCredentialSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "小青蛙平台接入参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await platformFrogService.configure(
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
