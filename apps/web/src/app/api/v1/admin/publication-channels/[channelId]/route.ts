import {
  publicationChannelIdSchema,
  updatePublicationChannelSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { publicationService } from "@/server/services/publications";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

type Context = { params: Promise<{ channelId: string }> };

export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = publicationChannelIdSchema.safeParse(await context.params);
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "渠道编号有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await publicationService.adminChannel(
        parsed.data.channelId,
        user.id,
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
    const params = publicationChannelIdSchema.safeParse(await context.params);
    if (!params.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "渠道编号有误",
        params.error.issues,
      );
    const { channelId } = params.data;
    const parsed = updatePublicationChannelSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布渠道更新参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await publicationService.updateChannel(
        channelId,
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
