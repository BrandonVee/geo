import { organizationQuerySchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { reportExportService } from "@/server/services/report-exports";
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
    const row = await reportExportService.file(
      exportId,
      parsed.data.organizationId,
      user.id,
    );
    return new Response(row.fileContent, {
      headers: {
        "content-type": `${row.mimeType}; charset=utf-8`,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        "cache-control": "private, no-store",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
