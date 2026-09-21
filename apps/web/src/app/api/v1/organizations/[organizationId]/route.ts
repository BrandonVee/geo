import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { organizationService } from "@/server/services/organizations";

type RouteContext = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { organizationId } = await context.params;
    return Response.json({
      data: await organizationService.get(organizationId, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
export async function PATCH(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { organizationId } = await context.params;
    return Response.json({
      data: await organizationService.update(organizationId, user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
