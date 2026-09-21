import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { adminService } from "@/server/services/admin";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return Response.json({
      data: await adminService.overview(user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
