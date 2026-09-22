import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { balanceService } from "@/server/services/balances";
import { apiJson } from "@/server/http/response";

export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return apiJson({
      data: await balanceService.adminList(user.id),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
