import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { parseAdminOrganizationPage } from "@/server/http/admin-request";
import { errorResponse } from "@/server/http/errors";
import { apiJson } from "@/server/http/response";
import { balanceService } from "@/server/services/balances";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await balanceService.organizationBalances(
        parseAdminOrganizationPage(request),
        user.id,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
