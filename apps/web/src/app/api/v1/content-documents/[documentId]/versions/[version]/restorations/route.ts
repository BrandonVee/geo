import { restoreContentDocumentVersionSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { z } from "zod";
import { auditContextFromRequest } from "@/server/audit/write-audit";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { contentDocumentService } from "@/server/services/content-documents";
import { apiJson } from "@/server/http/response";

type Context = {
  params: Promise<{ documentId: string; version: string }>;
};

export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const params = await context.params;
    const id = z.string().uuid().safeParse(params.documentId);
    const version = z.coerce
      .number()
      .int()
      .positive()
      .safeParse(params.version);
    const parsed = restoreContentDocumentVersionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!id.success || !version.success || !parsed.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "请求参数有误",
        parsed.success ? undefined : parsed.error.issues,
      );
    return apiJson({
      data: await contentDocumentService.restoreVersion(
        parsed.data,
        id.data,
        version.data,
        parsed.data,
        user.id,
        auditContextFromRequest(
          request,
          parsed.data.organizationId,
          user.id,
          requestId,
        ),
      ),
      requestId,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
