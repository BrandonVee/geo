import { adminCreateAnswerBitBrandSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { platformAnswerbitService } from "@/server/services/platform-answerbit";
import { validateBrandIconPayload } from "../../../../../server/http/brand-icon";

export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = adminCreateAnswerBitBrandSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "腾讯品牌参数有误",
        parsed.error.issues,
      );
    if (parsed.data.iconMimeType && parsed.data.iconData) {
      const validatedIcon = validateBrandIconPayload(
        parsed.data.iconMimeType,
        parsed.data.iconData,
      );
      if (!validatedIcon.success)
        throw new ApiError(400, "VALIDATION_ERROR", validatedIcon.message);
    }
    const brand = await platformAnswerbitService.createBrand(
      parsed.data,
      user.id,
      auditContextFromRequest(request, undefined, user.id, requestId),
    );
    return Response.json(
      { data: brand, requestId },
      {
        status: 201,
        headers: {
          Location: `/api/v1/admin/answerbit-brands/${encodeURIComponent(brand.brandId)}`,
        },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
