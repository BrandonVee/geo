import { organizationQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { reportExportService } from "@/server/services/report-exports";
import { apiJson } from "@/server/http/response";
type Context = { params: Promise<{ exportId: string }> };
export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { exportId } = await context.params;
    const parsed = organizationQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "企业参数有误",
        parsed.error.issues,
      );
    return apiJson({
      data: await reportExportService.get(
        exportId,
        parsed.data.organizationId,
        user.id,
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
