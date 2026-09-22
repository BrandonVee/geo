import { brandResourceQuerySchema, updateCategorySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { categoryService } from "@/server/services/prompts";
import { apiJson, emptyResponse } from "@/server/http/response";
type Context = { params: Promise<{ categoryId: string }> };
const idSchema = z.string().trim().min(1).max(128);
export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const id = idSchema.safeParse((await context.params).categoryId);
    const body = updateCategorySchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!id.success || !body.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        body.success ? undefined : body.error.issues,
      );
    return apiJson({
      data: await categoryService.update(
        id.data,
        body.data,
        user.id,
        requestId,
        auditContextFromRequest(
          request,
          body.data.organizationId,
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
    const id = idSchema.safeParse((await context.params).categoryId);
    const query = brandResourceQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!id.success || !query.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        query.success ? undefined : query.error.issues,
      );
    await categoryService.remove(
      query.data,
      id.data,
      user.id,
      requestId,
      auditContextFromRequest(
        request,
        query.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return emptyResponse(requestId, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
