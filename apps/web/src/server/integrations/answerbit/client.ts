import { setTimeout as delay } from "node:timers/promises";
import {
  BoundedJsonResponseError,
  discardResponseBody,
  InvalidAnswerBitEnvelopeError,
  parseAnswerBitEnvelope,
  readBoundedJsonResponse,
  type AnswerBitOperation,
} from "@geo/core";
import { z } from "zod";
import { AnswerBitError } from "./errors";
const retryAfterMs = (value: string | null) => {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    const milliseconds = seconds * 1000;
    if (Number.isSafeInteger(milliseconds) && milliseconds >= 0)
      return milliseconds;
  }
  const instant = Date.parse(value);
  return Number.isNaN(instant) ? undefined : Math.max(0, instant - Date.now());
};
export class AnswerBitClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = process.env.ANSWERBIT_BASE_URL ??
      "https://answerbit.qq.com",
  ) {}
  async post<T>(
    operation: AnswerBitOperation,
    payload: unknown,
    schema: z.ZodType<T>,
    requestId: string,
    options: {
      retries?: number;
      timeoutMs?: number;
      retryRateLimited?: boolean;
      retryTransient?: boolean;
    } = {},
  ): Promise<T> {
    const retries = options.retries ?? 0;
    const timeoutMs = options.timeoutMs ?? 15_000;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      let responseStatus: number | undefined;
      try {
        const response = await fetch(new URL(operation, this.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-API-Key": this.apiKey,
            "X-Request-ID": requestId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });
        responseStatus = response.status;
        if (!response.ok) {
          await discardResponseBody(response);
          if (response.status === 401 || response.status === 403)
            throw new AnswerBitError(
              "unauthorized",
              operation,
              response.status,
            );
          if (response.status === 429)
            throw new AnswerBitError(
              "rate_limited",
              operation,
              response.status,
              undefined,
              retryAfterMs(response.headers.get("retry-after")),
            );
          if (response.status >= 500)
            throw new AnswerBitError("upstream", operation, response.status);
          throw new AnswerBitError("business", operation, response.status);
        }
        const envelope = parseAnswerBitEnvelope(
          await readBoundedJsonResponse(response),
        );
        if (envelope.code !== 0)
          throw new AnswerBitError(
            "business",
            operation,
            response.status,
            envelope.code,
          );
        const parsed = schema.safeParse(envelope.data);
        if (!parsed.success)
          throw new AnswerBitError(
            "invalid_response",
            operation,
            response.status,
          );
        return parsed.data;
      } catch (error) {
        const normalized =
          error instanceof AnswerBitError
            ? error
            : error instanceof BoundedJsonResponseError ||
                error instanceof InvalidAnswerBitEnvelopeError
              ? new AnswerBitError(
                  "invalid_response",
                  operation,
                  responseStatus,
                )
              : new AnswerBitError(
                  error instanceof DOMException && error.name === "TimeoutError"
                    ? "timeout"
                    : "upstream",
                  operation,
                );
        const retryable =
          ((normalized.kind === "timeout" || normalized.kind === "upstream") &&
            options.retryTransient !== false) ||
          (normalized.kind === "rate_limited" &&
            options.retryRateLimited === true);
        if (!retryable || attempt === retries) throw normalized;
        await delay(
          Math.min(5_000, normalized.retryAfterMs ?? 500 * 2 ** attempt),
        );
      }
    }
    throw new AnswerBitError("upstream", operation);
  }
}
