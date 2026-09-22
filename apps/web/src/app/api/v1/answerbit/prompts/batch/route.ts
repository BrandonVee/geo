import {
  createPromptsBatchSchema,
  deletePromptsBatchSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { promptService } from "@/server/services/prompts";
import { apiJson, emptyResponse } from "@/server/http/response";
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = createPromptsBatchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.error.issues,
      );
    const data = await promptService.createBatch(
      parsed.data,
      user.id,
      requestId,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return apiJson({ data, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function DELETE(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = deletePromptsBatchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.error.issues,
      );
    const { promptIds, ...scope } = parsed.data;
    await promptService.removeBatch(
      scope,
      promptIds,
      user.id,
      requestId,
      auditContextFromRequest(
        request,
        scope.organizationId,
        user.id,
        requestId,
      ),
    );
    return emptyResponse(requestId, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
