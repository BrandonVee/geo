import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { organizationService } from "@/server/services/organizations";
import { apiJson, emptyResponse } from "@/server/http/response";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
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
    return emptyResponse(requestId, { status: 410 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
