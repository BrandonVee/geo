import { brandListQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { brandService } from "@/server/services/brands";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = brandListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        parsed.error.issues,
      );
    return Response.json({
      data: await brandService.list(
        parsed.data.organizationId,
        parsed.data.teamBindingId,
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
    await requireUser(request);
    throw new ApiError(
      410,
      "ANSWERBIT_BRAND_PLATFORM_MANAGED",
      "腾讯企业只允许在平台管理端新增",
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
