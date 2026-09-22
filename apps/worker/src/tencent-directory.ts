import { setTimeout as delay } from "node:timers/promises";
import { parseTencentBrandDirectory } from "@geo/core";

type DirectoryErrorKind =
  | "unauthorized"
  | "rate_limited"
  | "business"
  | "invalid_response"
  | "timeout"
  | "upstream";

type Envelope = { code: number; msg?: string; data: unknown };
type DirectoryFetch = (input: URL, init: RequestInit) => Promise<Response>;

export class TencentDirectoryError extends Error {
  constructor(
    readonly kind: DirectoryErrorKind,
    readonly httpStatus?: number,
    readonly answerbitCode?: number,
  ) {
    super(`TENCENT_DIRECTORY_${kind.toUpperCase()}`);
  }
}

export async function queryTencentBrandDirectory(
  input: {
    apiKey: string;
    teamId: string;
    requestId: string;
    baseUrl: string;
  },
  dependencies: {
    fetch?: DirectoryFetch;
    sleep?: (milliseconds: number) => Promise<unknown>;
  } = {},
) {
  const fetchDirectory = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? delay;

  for (let attempt = 0; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchDirectory(
        new URL("/geo/query/brand", input.baseUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-API-Key": input.apiKey,
            "X-Request-ID": input.requestId,
          },
          body: JSON.stringify({ team_id: input.teamId }),
          signal: AbortSignal.timeout(4_500),
        },
      );
      if (response.status === 401 || response.status === 403)
        throw new TencentDirectoryError("unauthorized", response.status);
      if (response.status === 429)
        throw new TencentDirectoryError("rate_limited", response.status);
      if (response.status >= 500)
        throw new TencentDirectoryError("upstream", response.status);
      if (!response.ok)
        throw new TencentDirectoryError("business", response.status);
      const envelope = (await response.json()) as Partial<Envelope>;
      if (!envelope || typeof envelope.code !== "number")
        throw new TencentDirectoryError("invalid_response", response.status);
      if (envelope.code !== 0)
        throw new TencentDirectoryError(
          "business",
          response.status,
          envelope.code,
        );
      try {
        return parseTencentBrandDirectory(envelope.data);
      } catch {
        throw new TencentDirectoryError("invalid_response", response.status);
      }
    } catch (error) {
      const normalized =
        error instanceof TencentDirectoryError
          ? error
          : new TencentDirectoryError(
              error instanceof DOMException && error.name === "TimeoutError"
                ? "timeout"
                : "upstream",
            );
      const retryable =
        normalized.kind === "timeout" || normalized.kind === "upstream";
      if (!retryable || attempt === 2) throw normalized;
      await sleep(200 * 2 ** attempt);
    }
  }
  throw new TencentDirectoryError("upstream");
}
