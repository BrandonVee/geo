import {
  competitorListQuerySchema,
  updateCompetitorSchema,
} from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { competitorService } from "@/server/services/competitors";
type Context = { params: Promise<{ competitorId: string }> };
const idSchema = z.string().trim().min(1).max(128);

export async function PATCH(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const id = idSchema.safeParse((await context.params).competitorId);
    const body = updateCompetitorSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!id.success || !body.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        body.success ? undefined : body.error.issues,
      );
    const data = await competitorService.update(
      id.data,
      body.data,
      user.id,
      requestId,
      auditContextFromRequest(
        request,
        body.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return Response.json({ data, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function DELETE(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const id = idSchema.safeParse((await context.params).competitorId);
    const query = competitorListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!id.success || !query.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "查询参数有误",
        query.success ? undefined : query.error.issues,
      );
    await competitorService.remove(
      query.data.organizationId,
      query.data.teamBindingId,
      query.data.brandId,
      id.data,
      user.id,
      requestId,
      auditContextFromRequest(
        request,
        query.data.organizationId,
        user.id,
        requestId,
      ),
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
