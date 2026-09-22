import { savedViewActionSchema, updateSavedViewSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { savedViewService } from "@/server/services/saved-views";
import { apiJson, emptyResponse } from "@/server/http/response";
type Context = { params: Promise<{ viewId: string }> };
export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { viewId } = await context.params;
    const parsed = updateSavedViewSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "保存视图更新参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await savedViewService.update(
        viewId,
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
export async function DELETE(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { viewId } = await context.params;
    const parsed = savedViewActionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "保存视图删除参数有误",
        parsed.error.issues,
      );
    await savedViewService.remove(
      viewId,
      parsed.data.organizationId,
      user.id,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return emptyResponse(requestId, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
