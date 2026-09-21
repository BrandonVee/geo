import { and, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "./client";
import {
  platformSubscriptions,
  quotaLedgers,
  subscriptionEntitlements,
} from "./schema";

export type QuotaReference = { type: string; id: string };
type ReserveQuotaInput = {
  organizationId: string;
  entitlementKey: string;
  amount: number;
  reference: QuotaReference;
  idempotencyKey: string;
  actorUserId?: string;
};
const errorCode = (error: unknown) => {
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
const availableAfter = (row: {
  limitAmount: number | null;
  usedAmount: number;
  reservedAmount: number;
}) =>
  row.limitAmount === null
    ? null
    : row.limitAmount - row.usedAmount - row.reservedAmount;

export async function reserveQuota(input: ReserveQuotaInput) {
  if (!Number.isInteger(input.amount) || input.amount <= 0)
    return { ok: false as const, code: "INVALID_QUOTA_AMOUNT" };
  try {
    return await db.transaction(async (tx) => {
      const [replay] = await tx
        .select()
        .from(quotaLedgers)
        .where(
          and(
            eq(quotaLedgers.organizationId, input.organizationId),
            eq(quotaLedgers.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) return { ok: true as const, replayed: true, ledger: replay };
      const [current] = await tx
        .select({
          id: subscriptionEntitlements.id,
          subscriptionId: subscriptionEntitlements.subscriptionId,
          limitAmount: subscriptionEntitlements.limitAmount,
          usedAmount: subscriptionEntitlements.usedAmount,
          reservedAmount: subscriptionEntitlements.reservedAmount,
        })
        .from(subscriptionEntitlements)
        .innerJoin(
          platformSubscriptions,
          eq(platformSubscriptions.id, subscriptionEntitlements.subscriptionId),
        )
        .where(
          and(
            eq(subscriptionEntitlements.organizationId, input.organizationId),
            eq(subscriptionEntitlements.entitlementKey, input.entitlementKey),
            eq(platformSubscriptions.status, "active"),
            gt(platformSubscriptions.currentPeriodEnd, new Date()),
          ),
        )
        .limit(1);
      if (!current)
        return { ok: false as const, code: "ENTITLEMENT_NOT_FOUND" };
      const [updated] = await tx
        .update(subscriptionEntitlements)
        .set({
          reservedAmount: sql`${subscriptionEntitlements.reservedAmount} + ${input.amount}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(subscriptionEntitlements.id, current.id),
            or(
              isNull(subscriptionEntitlements.limitAmount),
              gte(
                sql`${subscriptionEntitlements.limitAmount} - ${subscriptionEntitlements.usedAmount} - ${subscriptionEntitlements.reservedAmount}`,
                input.amount,
              ),
            ),
          ),
        )
        .returning();
      if (!updated)
        return {
          ok: false as const,
          code: "QUOTA_EXHAUSTED",
          available: availableAfter(current),
        };
      const [ledger] = await tx
        .insert(quotaLedgers)
        .values({
          organizationId: input.organizationId,
          subscriptionId: current.subscriptionId,
          entitlementId: current.id,
          entitlementKey: input.entitlementKey,
          operation: "reserve",
          amount: input.amount,
          balanceAfter: availableAfter(updated),
          referenceType: input.reference.type,
          referenceId: input.reference.id,
          idempotencyKey: input.idempotencyKey,
          actorUserId: input.actorUserId,
        })
        .returning();
      return { ok: true as const, replayed: false, ledger };
    });
  } catch (error) {
    if (errorCode(error) === "23505") {
      const [replay] = await db
        .select()
        .from(quotaLedgers)
        .where(
          and(
            eq(quotaLedgers.organizationId, input.organizationId),
            eq(quotaLedgers.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replay) return { ok: true as const, replayed: true, ledger: replay };
    }
    throw error;
  }
}

async function settleQuota(
  organizationId: string,
  reservationKey: string,
  operation: "commit" | "release",
) {
  const settlementKey = `${reservationKey}:${operation}`;
  try {
    return await db.transaction(async (tx) => {
      const [replay] = await tx
        .select()
        .from(quotaLedgers)
        .where(
          and(
            eq(quotaLedgers.organizationId, organizationId),
            eq(quotaLedgers.idempotencyKey, settlementKey),
          ),
        )
        .limit(1);
      if (replay) return { ok: true as const, replayed: true, ledger: replay };
      const [reservation] = await tx
        .select()
        .from(quotaLedgers)
        .where(
          and(
            eq(quotaLedgers.organizationId, organizationId),
            eq(quotaLedgers.idempotencyKey, reservationKey),
            eq(quotaLedgers.operation, "reserve"),
          ),
        )
        .limit(1);
      if (!reservation)
        return { ok: false as const, code: "RESERVATION_NOT_FOUND" };
      const changes =
        operation === "commit"
          ? {
              reservedAmount: sql`${subscriptionEntitlements.reservedAmount} - ${reservation.amount}`,
              usedAmount: sql`${subscriptionEntitlements.usedAmount} + ${reservation.amount}`,
              updatedAt: new Date(),
            }
          : {
              reservedAmount: sql`${subscriptionEntitlements.reservedAmount} - ${reservation.amount}`,
              updatedAt: new Date(),
            };
      const [updated] = await tx
        .update(subscriptionEntitlements)
        .set(changes)
        .where(
          and(
            eq(subscriptionEntitlements.id, reservation.entitlementId),
            sql`${subscriptionEntitlements.reservedAmount} >= ${reservation.amount}`,
          ),
        )
        .returning();
      if (!updated)
        return { ok: false as const, code: "RESERVATION_ALREADY_SETTLED" };
      const [ledger] = await tx
        .insert(quotaLedgers)
        .values({
          organizationId,
          subscriptionId: reservation.subscriptionId,
          entitlementId: reservation.entitlementId,
          entitlementKey: reservation.entitlementKey,
          operation,
          amount: reservation.amount,
          balanceAfter: availableAfter(updated),
          referenceType: reservation.referenceType,
          referenceId: reservation.referenceId,
          idempotencyKey: settlementKey,
          reason:
            operation === "commit"
              ? "任务成功确认消耗"
              : "任务失败或取消释放预占",
        })
        .returning();
      return { ok: true as const, replayed: false, ledger };
    });
  } catch (error) {
    if (errorCode(error) === "23505") {
      const [replay] = await db
        .select()
        .from(quotaLedgers)
        .where(
          and(
            eq(quotaLedgers.organizationId, organizationId),
            eq(quotaLedgers.idempotencyKey, settlementKey),
          ),
        )
        .limit(1);
      if (replay) return { ok: true as const, replayed: true, ledger: replay };
    }
    throw error;
  }
}
export const commitQuota = (organizationId: string, reservationKey: string) =>
  settleQuota(organizationId, reservationKey, "commit");
export const releaseQuota = (organizationId: string, reservationKey: string) =>
  settleQuota(organizationId, reservationKey, "release");
