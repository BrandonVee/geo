export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const databaseErrorCode = (error: unknown) => {
  let current = error;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth += 1
  ) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};
export const errorResponse = (error: unknown, requestId: string) => {
  if (error instanceof ApiError)
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        requestId,
      },
      { status: error.status },
    );
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      event: "request.failed",
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" }, requestId },
    { status: 500 },
  );
};
