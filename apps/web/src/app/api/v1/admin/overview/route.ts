import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { adminService } from "@/server/services/admin";
import { apiJson } from "@/server/http/response";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await adminService.overview(user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
