import { notificationReadAllSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { readJsonBody } from "@/server/http/request-body";
import { ApiError, errorResponse } from "@/server/http/errors";
import { apiJson } from "@/server/http/response";
import { notificationService } from "@/server/services/notifications";
export async function PUT(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = notificationReadAllSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "通知已读范围参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await notificationService.readAll(parsed.data, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
