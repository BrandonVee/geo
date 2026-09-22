import {
  adminPublicationChannelQuerySchema,
  createPublicationChannelSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { publicationService } from "@/server/services/publications";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = adminPublicationChannelQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布渠道查询参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await publicationService.adminChannels(parsed.data, user.id),
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
    const parsed = createPublicationChannelSchema.safeParse(
      await readJsonBody(request),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布渠道参数有误",
        parsed.error.issues,
      );
    const data = await publicationService.createChannel(
      parsed.data,
      user.id,
      auditContextFromRequest(request, undefined, user.id, requestId),
    );
    return apiJson({ data, requestId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
