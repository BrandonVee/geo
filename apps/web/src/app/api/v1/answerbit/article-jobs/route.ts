import {
  articleJobListQuerySchema,
  createArticleJobSchema,
  idempotencyKeySchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { articleService } from "@/server/services/articles";
import { apiJson } from "@/server/http/response";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = articleJobListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        parsed.error.issues,
      );
    const { limit, ...scope } = parsed.data;
    return apiJson({
      data: await articleService.listJobs(scope, limit, user.id),
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
    const parsed = createArticleJobSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!key.success || !parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        key.success ? "请求参数有误" : "Idempotency-Key 缺失或格式错误",
        parsed.success ? undefined : parsed.error.issues,
      );
    const data = await articleService.createJob(
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
        status: data.replayed ? 200 : 202,
        headers: { Location: `/api/v1/answerbit/article-jobs/${data.id}` },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
