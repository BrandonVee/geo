import { articleTemplateQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { articleService } from "@/server/services/articles";
import { apiJson } from "@/server/http/response";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = articleTemplateQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        parsed.error.issues,
      );
    const { localCode, ...scope } = parsed.data;
    return apiJson({
      data: await articleService.templates(
        scope,
        localCode,
        user.id,
        requestId,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
