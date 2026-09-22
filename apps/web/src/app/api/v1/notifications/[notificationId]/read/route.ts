import { notificationReadSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { notificationService } from "@/server/services/notifications";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

type Context = { params: Promise<{ notificationId: string }> };
export async function PUT(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { notificationId } = await context.params;
    const parsed = notificationReadSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "通知读取状态参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await notificationService.setRead(
        notificationId,
        parsed.data.organizationId,
        parsed.data.read,
        user.id,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
