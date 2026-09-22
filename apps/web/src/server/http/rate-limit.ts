import { copyResponseHeaders } from "./response";

export const retryAfterSeconds = (milliseconds: number) =>
  Number.isFinite(milliseconds) && milliseconds >= 0
    ? String(Math.ceil(milliseconds / 1000))
    : undefined;

export function normalizeRetryAfterHeader(response: Response) {
  if (response.status !== 429 || response.headers.has("Retry-After"))
    return response;

  const legacyValue = response.headers.get("X-Retry-After");
  if (!legacyValue || !/^\d+$/.test(legacyValue)) return response;

  const headers = copyResponseHeaders(response.headers);
  headers.set("Retry-After", legacyValue);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
