import { createRequestId } from "@geo/core";
import { requireUser } from "@/server/auth/session";
import { ApiError, errorResponse } from "@/server/http/errors";
import { publicationService } from "@/server/services/publications";

export async function GET(
  request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const requestId = createRequestId();
  try {
    const user = await requireUser(request);
    const { channelId } = await context.params;
    const data = await publicationService.channel(channelId, user.id);
    if (!data)
      throw new ApiError(
        404,
        "PUBLICATION_CHANNEL_NOT_FOUND",
        "发布渠道不存在或已下架",
      );
    return Response.json({ data, requestId });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
