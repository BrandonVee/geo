import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { errorResponse } from "@/server/http/errors";
import { parseDashboardQuery } from "@/server/http/parse-dashboard-query";
import { insightService } from "@/server/services/insights";
export async function GET(request: Request) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    return Response.json({
      data: await insightService.promptTrends(
        parseDashboardQuery(request, false),
        user.id,
        requestId,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
