import {
  competitorListQuerySchema,
  createCompetitorSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { competitorService } from "@/server/services/competitors";
import { apiJson } from "@/server/http/response";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = competitorListQuerySchema.safeParse(
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
      data: await competitorService.list(
        parsed.data.organizationId,
        parsed.data.teamBindingId,
        parsed.data.brandId,
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
    const parsed = createCompetitorSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.error.issues,
      );
    const data = await competitorService.create(
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
          Location: `/api/v1/answerbit/competitors/${encodeURIComponent(data.competitorId)}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
