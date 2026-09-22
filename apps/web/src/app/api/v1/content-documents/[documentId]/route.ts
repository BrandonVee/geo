import {
  brandResourceQuerySchema,
  updateContentDocumentSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { contentDocumentService } from "@/server/services/content-documents";
import { apiJson, emptyResponse } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

type Context = { params: Promise<{ documentId: string }> };

async function documentId(context: Context) {
  return z
    .string()
    .uuid()
    .safeParse((await context.params).documentId);
}

export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const [id, scope] = await Promise.all([
      documentId(context),
      Promise.resolve(
        brandResourceQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      ),
    ]);
    if (!id.success || !scope.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        scope.success ? undefined : scope.error.issues,
      );
    return apiJson({
      data: await contentDocumentService.get(scope.data, id.data, user.id),
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
    const [id, input] = await Promise.all([
      documentId(context),
      readJsonBody(request),
    ]);
    const parsed = updateContentDocumentSchema.safeParse(input);
    if (!id.success || !parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.success ? undefined : parsed.error.issues,
      );
    return apiJson({
      data: await contentDocumentService.update(
        parsed.data,
        id.data,
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
    const [id, scope] = await Promise.all([
      documentId(context),
      Promise.resolve(
        brandResourceQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      ),
    ]);
    if (!id.success || !scope.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        scope.success ? undefined : scope.error.issues,
      );
    await contentDocumentService.archive(
      scope.data,
      id.data,
      user.id,
      auditContextFromRequest(
        request,
        scope.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return emptyResponse(requestId, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
