import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { parseDashboardQuery } from "@/server/http/parse-dashboard-query";
import { dashboardService } from "@/server/services/dashboard";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return Response.json({
      data: await dashboardService.exposureRank(
        parseDashboardQuery(request, true),
        user.id,
        requestId,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
