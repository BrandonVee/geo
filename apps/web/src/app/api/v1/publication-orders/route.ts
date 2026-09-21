import {
  createPublicationOrderSchema,
  publicationOrderQuerySchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { publicationService } from "@/server/services/publications";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const parsed = publicationOrderQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布订单查询参数有误",
        parsed.error.issues,
      );
    return Response.json({
      data: await publicationService.list(
        parsed.data.organizationId,
        parsed.data.teamBindingId,
        parsed.data.brandId,
        user.id,
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
    const parsed = createPublicationOrderSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "发布订单参数有误",
        parsed.error.issues,
      );
    const data = await publicationService.create(
      parsed.data,
      user.id,
      auditContextFromRequest(
        request,
        parsed.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return Response.json(
      { data, requestId },
      { status: data.replayed ? 200 : 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
