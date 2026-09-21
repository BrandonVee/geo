import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { adminService } from "@/server/services/admin";

export async function PUT(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    await adminService.rejectOrganizationBrandBinding(user.id);
    return new Response(null, { status: 410 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
