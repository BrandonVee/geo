import { categoryListQuerySchema, createCategorySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { categoryService } from "@/server/services/prompts";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = categoryListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        parsed.error.issues,
      );
    const { organizationId, teamBindingId, brandId, id, titleName } =
      parsed.data;
    return apiJson({
      data: await categoryService.list(
        { organizationId, teamBindingId, brandId },
        { id, titleName },
        user.id,
        requestId,
      ),
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
    const parsed = createCategorySchema.safeParse(await readJsonBody(request));
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.error.issues,
      );
    const data = await categoryService.create(
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
    return apiJson(
      { data, requestId },
      {
        status: 201,
        headers: {
          Location: `/api/v1/answerbit/categories/${encodeURIComponent(data.titleId)}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
