import { bootstrapAdminSchema } from "@geo/contracts";
import { createRequestId } from "@geo/core";
import { noStoreJson, withNoStore } from "@/server/http/cache";
import { ApiError, errorResponse } from "@/server/http/errors";
import { identityService } from "@/server/modules/identity/identity.service";
import { apiJson } from "@/server/http/response";
import { readJsonBody } from "@/server/http/request-body";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = createRequestId();

  try {
    return noStoreJson({
      data: { initialized: await identityService.isInitialized() },
      requestId,
    });
  } catch (error) {
    return withNoStore(errorResponse(error, requestId));
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const parsed = bootstrapAdminSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "管理员账号参数有误",
        parsed.error.issues,
      );
    }

    const administrator = await identityService.bootstrapAdministrator(
      parsed.data,
    );
    return apiJson(
      { data: administrator, requestId },
      {
        status: 201,
        headers: { Location: "/sign-in" },
      },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
