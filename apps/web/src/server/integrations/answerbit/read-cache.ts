import { createHash } from "node:crypto";
import {
  answerbitReadCache,
  withTenantDbContext,
  type DatabaseTransaction,
} from "@geo/db";
import type { AnswerBitOperation } from "@geo/core";
import { eq, sql } from "drizzle-orm";
import { AnswerBitError } from "./errors";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;

// Sort object keys, but preserve array order: arrays can be semantically ordered.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const unorderedFilterKeys = new Set([
  "title_ids",
  "competitor_ids",
  "platforms",
  "tag_ids",
]);

export function normalizeCachePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCachePayload);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const normalized = normalizeCachePayload(item);
      return [
        key,
        unorderedFilterKeys.has(key) && Array.isArray(normalized)
          ? [...normalized].sort((left, right) =>
              canonicalJson(left).localeCompare(canonicalJson(right)),
            )
          : normalized,
      ];
    }),
  );
}

export function cacheTtlMs(payload: unknown): number {
  if (payload && typeof payload === "object" && "end_date" in payload) {
    const endDate = (payload as { end_date?: unknown }).end_date;
    if (typeof endDate === "string") {
      const today = new Date().toISOString().slice(0, 10);
      if (endDate >= today) return HOUR_MS;
    }
  }
  return DAY_MS;
}

// @project-doc docs/interfaces/answerbit_integration.md#read_cache
export async function cachedAnswerBitRead<T>(input: {
  operation: AnswerBitOperation;
  organizationId: string;
  brandId?: string;
  actorUserId: string;
  apiKey: string;
  payload: unknown;
  execute: (tx: DatabaseTransaction) => Promise<T>;
  onFreshResult?: (response: T) => Promise<void>;
}): Promise<T> {
  const key = hash(
    canonicalJson({
      operation: input.operation,
      appVersion: process.env.APP_VERSION ?? "local",
      organizationId: input.organizationId,
      brandId: input.brandId,
      credentialHash: hash(input.apiKey),
      payload: normalizeCachePayload(input.payload),
    }),
  );
  let fetched = false;
  const result = await withTenantDbContext(
    {
      organizationId: input.organizationId,
      userId: input.actorUserId,
      brandId: input.brandId,
    },
    async (tx) => {
      let [cached] = await tx
        .select()
        .from(answerbitReadCache)
        .where(eq(answerbitReadCache.cacheKey, key))
        .limit(1);
      if (cached && cached.expiresAt.getTime() > Date.now())
        return cached.response as T;

      // The transaction lock coalesces concurrent misses across Web instances.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      [cached] = await tx
        .select()
        .from(answerbitReadCache)
        .where(eq(answerbitReadCache.cacheKey, key))
        .limit(1);
      if (cached && cached.expiresAt.getTime() > Date.now())
        return cached.response as T;

      let response: T;
      try {
        response = await input.execute(tx);
        fetched = true;
      } catch (error) {
        // Only read data already fetched from the same credential and scope may
        // serve a bounded stale copy when Tencent explicitly rate-limits us.
        if (
          error instanceof AnswerBitError &&
          error.kind === "rate_limited" &&
          cached &&
          Date.now() - cached.checkedAt.getTime() < 7 * DAY_MS
        ) {
          const retryAt = Math.min(
            cached.checkedAt.getTime() + 7 * DAY_MS,
            Date.now() +
              Math.max(15 * 60_000, Math.min(error.retryAfterMs ?? 0, HOUR_MS)),
          );
          await tx
            .update(answerbitReadCache)
            .set({ expiresAt: new Date(retryAt) })
            .where(eq(answerbitReadCache.cacheKey, key));
          return cached.response as T;
        }
        throw error;
      }
      const checkedAt = new Date();
      const responseHash = hash(canonicalJson(response));
      await tx
        .insert(answerbitReadCache)
        .values({
          cacheKey: key,
          organizationId: input.organizationId,
          brandId: input.brandId,
          operation: input.operation,
          response,
          responseHash,
          checkedAt,
          expiresAt: new Date(checkedAt.getTime() + cacheTtlMs(input.payload)),
        })
        .onConflictDoUpdate({
          target: answerbitReadCache.cacheKey,
          set: {
            response:
              cached?.responseHash === responseHash
                ? cached.response
                : response,
            responseHash,
            checkedAt,
            expiresAt: new Date(
              checkedAt.getTime() + cacheTtlMs(input.payload),
            ),
          },
        });
      return response;
    },
  );
  // Run consumers after commit, outside the cache lock. Cache hits and bounded
  // stale fallback are display snapshots, not new upstream observations.
  if (fetched) await input.onFreshResult?.(result);
  return result;
}
