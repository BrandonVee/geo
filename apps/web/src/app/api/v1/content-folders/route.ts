import {
  contentFolderListQuerySchema,
  createContentFolderSchema,
  idempotencyKeySchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { contentDocumentService } from "@/server/services/content-documents";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = contentFolderListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await contentDocumentService.listFolders(parsed.data, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = createContentFolderSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.error.issues,
      );
    const rawKey = request.headers.get("Idempotency-Key");
    const key =
      rawKey === null ? undefined : idempotencyKeySchema.safeParse(rawKey);
    if (key && !key.success)
      throw new ApiError(400, "VALIDATION_ERROR", "Idempotency-Key 格式错误");
    const data = await contentDocumentService.createFolder(
      parsed.data,
      user.id,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
      key?.success ? key.data : undefined,
    );
    return apiJson(
      { data, requestId },
      {
        status: data.replayed ? 200 : 201,
        headers: { Location: `/api/v1/content-folders/${data!.id}` },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
