import {
  brandResourceQuerySchema,
  updateContentFolderSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { contentDocumentService } from "@/server/services/content-documents";
import { apiJson, emptyResponse } from "@/server/http/response";

type Context = { params: Promise<{ folderId: string }> };

export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const id = z
      .string()
      .uuid()
      .safeParse((await context.params).folderId);
    const parsed = updateContentFolderSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!id.success || !parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.success ? undefined : parsed.error.issues,
      );
    return apiJson({
      data: await contentDocumentService.updateFolder(
        parsed.data,
        id.data,
        parsed.data.name,
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
    const id = z
      .string()
      .uuid()
      .safeParse((await context.params).folderId);
    const scope = brandResourceQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!id.success || !scope.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        scope.success ? undefined : scope.error.issues,
      );
    await contentDocumentService.deleteFolder(
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
