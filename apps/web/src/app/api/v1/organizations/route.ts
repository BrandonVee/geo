import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { organizationService } from "@/server/services/organizations";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return Response.json({
      data: await organizationService.list(user.id),
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
    await organizationService.create(user.id);
    return new Response(null, { status: 410 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
