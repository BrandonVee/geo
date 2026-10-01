import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { parseAdminOrganizationPage } from "@/server/http/admin-request";
import { adminService } from "@/server/services/admin";
import { apiJson, emptyResponse } from "@/server/http/response";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await adminService.organizations(
        parseAdminOrganizationPage(request),
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
    await adminService.rejectLocalOrganizationCreation(user.id);
    return emptyResponse(requestId, { status: 410 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
