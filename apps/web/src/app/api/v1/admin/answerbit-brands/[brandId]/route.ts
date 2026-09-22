import { adminUpdateAnswerBitBrandSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { platformAnswerbitService } from "@/server/services/platform-answerbit";
import { apiJson, emptyResponse } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

type Context = { params: Promise<{ brandId: string }> };

async function brandIdFrom(context: Context) {
  const parsed = z
    .string()
    .trim()
    .min(1)
    .max(128)
    .safeParse((await context.params).brandId);
  if (!parsed.success)
    throw new ApiError(400, "VALIDATION_ERROR", "brandId 格式错误");
  return parsed.data;
}

export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const brandId = await brandIdFrom(context);
    return apiJson({
      data: await platformAnswerbitService.getBrand(
        brandId,
        user.id,
        requestId,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const brandId = await brandIdFrom(context);
    const parsed = adminUpdateAnswerBitBrandSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "腾讯企业参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await platformAnswerbitService.updateBrand(
        brandId,
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

export async function DELETE(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const brandId = await brandIdFrom(context);
    await platformAnswerbitService.deleteBrand(
      brandId,
      user.id,
      auditContextFromRequest(request, undefined, user.id, requestId),
    );
    return emptyResponse(requestId, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
