import { ApiError } from "./errors";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 4 * 1024 * 1024;

const readableLimit = (maxBytes: number) =>
  maxBytes % (1024 * 1024) === 0
    ? `${maxBytes / (1024 * 1024)} MiB`
    : `${maxBytes} 字节`;

const payloadTooLarge = (maxBytes: number) =>
  new ApiError(
    413,
    "PAYLOAD_TOO_LARGE",
    `JSON 请求体不能超过 ${readableLimit(maxBytes)}`,
  );

const unsupportedMediaType = () =>
  new ApiError(
    415,
    "UNSUPPORTED_MEDIA_TYPE",
    "Content-Type 必须是 application/json",
  );

const hasJsonContentType = (request: Request) => {
  const contentType = request.headers.get("Content-Type");
  if (!contentType) return false;
  const [mediaType, ...parameters] = contentType
    .split(";")
    .map((part) => part.trim().toLowerCase());
  const jsonMediaType =
    mediaType === "application/json" ||
    /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(mediaType);
  if (!jsonMediaType) return false;

  return parameters.every((parameter) => {
    const separator = parameter.indexOf("=");
    if (separator < 0) return false;
    if (parameter.slice(0, separator).trim() !== "charset") return true;
    const rawCharset = parameter.slice(separator + 1).trim();
    const startsQuoted = rawCharset.startsWith('"');
    const endsQuoted = rawCharset.endsWith('"');
    if (startsQuoted !== endsQuoted) return false;
    const charset = startsQuoted ? rawCharset.slice(1, -1) : rawCharset;
    return charset === "utf-8" || charset === "utf8";
  });
};

const declaredLengthExceeds = (request: Request, maxBytes: number) => {
  const contentLength = request.headers.get("Content-Length");
  if (!contentLength || !/^\d+$/.test(contentLength)) return false;
  return Number(contentLength) > maxBytes;
};

export async function readJsonBody(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES,
): Promise<unknown> {
  if (!request.body) return null;
  if (!hasJsonContentType(request)) throw unsupportedMediaType();
  if (declaredLengthExceeds(request, maxBytes)) throw payloadTooLarge(maxBytes);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw payloadTooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}
