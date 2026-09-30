import {
  articleListQuerySchema,
  traceArticleSchema,
  idempotencyKeySchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { articleService } from "@/server/services/articles";
import { articleTrackingService } from "@/server/services/article-tracking";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = articleListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "文章筛选参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await articleService.list(parsed.data, user.id, requestId),
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
    const key = idempotencyKeySchema.safeParse(
      request.headers.get("Idempotency-Key"),
    );
    if (!key.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "Idempotency-Key 缺失或格式错误",
      );
    const parsed = traceArticleSchema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.error.issues,
      );
    const data = await articleTrackingService.create(
      parsed.data,
      key.data,
      user.id,
      requestId,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return apiJson(
      { data, requestId },
      {
        status: data.status === "succeeded" ? (data.replayed ? 200 : 201) : 202,
        headers: {
          Location: data.articleId
            ? `/api/v1/answerbit/articles/${encodeURIComponent(data.articleId)}`
            : "/api/v1/answerbit/article-tracking-submissions",
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
