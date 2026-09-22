import { adminUpdateAnswerBitBrandIconSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { platformAnswerbitService } from "@/server/services/platform-answerbit";
import { validateBrandIconPayload } from "../../../../../../../server/http/brand-icon";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

type Context = { params: Promise<{ brandId: string }> };

export async function PUT(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const brandId = z
      .string()
      .trim()
      .min(1)
      .max(128)
      .safeParse((await context.params).brandId);
    if (!brandId.success)
      throw new ApiError(400, "VALIDATION_ERROR", "brandId 格式错误");
    const parsed = adminUpdateAnswerBitBrandIconSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success) {
      const iconDataIssue = parsed.error.issues.find(
        (issue) => issue.path[0] === "iconData",
      );
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        iconDataIssue?.message ?? "腾讯品牌 Logo 参数有误",
        parsed.error.issues,
      );
    }
    const validatedIcon = validateBrandIconPayload(
      parsed.data.iconMimeType,
      parsed.data.iconData,
    );
    if (!validatedIcon.success)
      throw new ApiError(400, "VALIDATION_ERROR", validatedIcon.message);
    return apiJson({
      data: await platformAnswerbitService.updateBrandIcon(
        brandId.data,
        parsed.data,
        user.id,
        auditContextFromRequest(request, undefined, user.id, requestId),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
