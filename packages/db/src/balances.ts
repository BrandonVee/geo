import { assertEnterpriseAccess } from "./enterprise-access";
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNull,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { db } from "./client";
import { withPlatformDbContext, type DatabaseTransaction } from "./context";
import { alias } from "drizzle-orm/pg-core";
import {
  answerbitBrandMappings,
  featurePointCosts,
  balanceAccounts,
  balanceTransactions,
  organizations,
  users,
} from "./schema";

export type BalanceAsset = "answerbit_points" | "publication_cny";
export type BalanceOperation =
  | "grant"
  | "allocate"
  | "consume"
  | "restore"
  | "adjust";
export type BalanceTransactionFilters = {
  organizationId?: string;
  userId?: string;
  asset?: BalanceAsset;
  operation?: BalanceOperation;
};

export type PointUsageFilters = {
  organizationId: string;
  brandId?: string;
  beginAt: Date;
  endAtExclusive: Date;
  operation?: "consume" | "restore";
  page: number;
  pageSize: number;
};

const accountWhere = (
  organizationId: string,
  asset: BalanceAsset,
  brandId?: string,
) =>
  and(
    eq(balanceAccounts.organizationId, organizationId),
    eq(balanceAccounts.asset, asset),
    brandId
      ? eq(balanceAccounts.brandId, brandId)
      : isNull(balanceAccounts.brandId),
  );

async function ensureAccount(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  asset: BalanceAsset,
  brandId?: string,
) {
  await tx
    .insert(balanceAccounts)
    .values({ organizationId, asset, brandId })
    .onConflictDoNothing();
  const [account] = await tx
    .select()
    .from(balanceAccounts)
    .where(accountWhere(organizationId, asset, brandId))
    .limit(1);
  if (!account) throw new Error("BALANCE_ACCOUNT_NOT_FOUND");
  return account;
}

async function lockIdempotencyKey(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  organizationId: string,
  idempotencyKey: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${idempotencyKey}))`,
  );
}

// @project-doc docs/domains/balance_and_publication.md#balance_invariants
export async function grantBalance(
  input: {
    organizationId: string;
    asset: BalanceAsset;
    amount: number;
    reason: string;
    idempotencyKey: string;
    actorUserId: string;
  },
  onCommitted?: (
    tx: DatabaseTransaction,
    transaction: typeof balanceTransactions.$inferSelect,
  ) => Promise<void>,
) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw new Error("INVALID_GRANT_AMOUNT");
  return db.transaction(async (tx) => {
    await lockIdempotencyKey(tx, input.organizationId, input.idempotencyKey);
    const [replay] = await tx
      .select()
      .from(balanceTransactions)
      .where(
        and(
          eq(balanceTransactions.organizationId, input.organizationId),
          eq(balanceTransactions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (replay) {
      const [account] = await tx
        .select()
        .from(balanceAccounts)
        .where(accountWhere(input.organizationId, input.asset))
        .limit(1);
      if (
        replay.operation !== "grant" ||
        replay.referenceType !== "manual_grant" ||
        replay.targetAccountId !== account?.id ||
        replay.amount !== input.amount ||
        replay.reason !== input.reason ||
        replay.actorUserId !== input.actorUserId
      )
        return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
      return {
        ok: true as const,
        transaction: replay,
        replayed: true as const,
      };
    }
    const account = await ensureAccount(tx, input.organizationId, input.asset);
    const [updated] = await tx
      .update(balanceAccounts)
      .set({
        balance: sql`${balanceAccounts.balance} + ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(balanceAccounts.id, account.id))
      .returning();
    const [transaction] = await tx
      .insert(balanceTransactions)
      .values({
        organizationId: input.organizationId,
        asset: input.asset,
        operation: "grant",
        amount: input.amount,
        targetAccountId: account.id,
        targetBalanceAfter: updated!.balance,
        referenceType: "manual_grant",
        referenceId: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        actorUserId: input.actorUserId,
      })
      .returning();
    await onCommitted?.(tx, transaction!);
    return {
      ok: true as const,
      transaction: transaction!,
      replayed: false as const,
    };
  });
}

// @project-doc docs/domains/identity_and_access.md#agent_quotas
export async function allocateBalance(
  input: {
    organizationId: string;
    brandId: string;
    asset: BalanceAsset;
    amount: number;
    reason: string;
    idempotencyKey: string;
    actorUserId: string;
  },
  onCommitted?: (
    tx: DatabaseTransaction,
    transaction: typeof balanceTransactions.$inferSelect,
  ) => Promise<void>,
) {
  return db.transaction(async (tx) => {
    await lockIdempotencyKey(tx, input.organizationId, input.idempotencyKey);
    const [replay] = await tx
      .select()
      .from(balanceTransactions)
      .where(
        and(
          eq(balanceTransactions.organizationId, input.organizationId),
          eq(balanceTransactions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (replay) {
      const [source] = await tx
        .select()
        .from(balanceAccounts)
        .where(accountWhere(input.organizationId, input.asset))
        .limit(1);
      const [target] = await tx
        .select()
        .from(balanceAccounts)
        .where(accountWhere(input.organizationId, input.asset, input.brandId))
        .limit(1);
      if (
        replay.operation !== "allocate" ||
        replay.asset !== input.asset ||
        replay.referenceType !== "brand_allocation" ||
        replay.referenceId !== input.brandId ||
        replay.sourceAccountId !== source?.id ||
        replay.targetAccountId !== target?.id ||
        replay.amount !== input.amount ||
        replay.reason !== input.reason ||
        replay.actorUserId !== input.actorUserId
      )
        return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
      return {
        ok: true as const,
        transaction: replay,
        replayed: true as const,
      };
    }
    if (input.asset === "answerbit_points") {
      const [actor] = await tx
        .select({
          accountType: users.accountType,
          limit: users.agentAnswerbitPointsLimit,
        })
        .from(users)
        .where(eq(users.id, input.actorUserId))
        .for("update")
        .limit(1);
      if (actor?.accountType === "agent" && actor.limit !== null) {
        const [usage] = await tx
          .select({
            value: sql<number>`coalesce(sum(${balanceTransactions.amount}), 0)::int`,
          })
          .from(balanceTransactions)
          .where(
            and(
              eq(balanceTransactions.actorUserId, input.actorUserId),
              eq(balanceTransactions.asset, "answerbit_points"),
              eq(balanceTransactions.operation, "allocate"),
            ),
          );
        if ((usage?.value ?? 0) + input.amount > actor.limit)
          return {
            ok: false as const,
            code: "AGENT_ANSWERBIT_POINTS_QUOTA_EXCEEDED" as const,
          };
      }
    }
    await assertEnterpriseAccess(
      input.organizationId,
      input.asset === "answerbit_points",
      tx,
    );
    const source = await ensureAccount(tx, input.organizationId, input.asset);
    const target = await ensureAccount(
      tx,
      input.organizationId,
      input.asset,
      input.brandId,
    );
    const [debited] = await tx
      .update(balanceAccounts)
      .set({
        balance: sql`${balanceAccounts.balance} - ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(balanceAccounts.id, source.id),
          sql`${balanceAccounts.balance} >= ${input.amount}`,
        ),
      )
      .returning();
    if (!debited)
      return { ok: false as const, code: "INSUFFICIENT_BALANCE" as const };
    const [credited] = await tx
      .update(balanceAccounts)
      .set({
        balance: sql`${balanceAccounts.balance} + ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(balanceAccounts.id, target.id))
      .returning();
    const [transaction] = await tx
      .insert(balanceTransactions)
      .values({
        organizationId: input.organizationId,
        asset: input.asset,
        operation: "allocate",
        amount: input.amount,
        sourceAccountId: source.id,
        targetAccountId: target.id,
        sourceBalanceAfter: debited.balance,
        targetBalanceAfter: credited!.balance,
        referenceType: "brand_allocation",
        referenceId: input.brandId,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        actorUserId: input.actorUserId,
      })
      .returning();
    await onCommitted?.(tx, transaction!);
    return {
      ok: true as const,
      transaction: transaction!,
      replayed: false as const,
    };
  });
}

export async function consumeBalance(
  input: {
    organizationId: string;
    brandId?: string;
    asset: BalanceAsset;
    amount: number;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
    reason: string;
    actorUserId?: string;
  },
  executor?: DatabaseTransaction,
) {
  const execute = async (tx: DatabaseTransaction) => {
    await lockIdempotencyKey(tx, input.organizationId, input.idempotencyKey);
    const [replay] = await tx
      .select()
      .from(balanceTransactions)
      .where(
        and(
          eq(balanceTransactions.organizationId, input.organizationId),
          eq(balanceTransactions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (replay)
      return {
        ok: true as const,
        transaction: replay,
        replayed: true as const,
      };
    await assertEnterpriseAccess(
      input.organizationId,
      input.asset === "answerbit_points",
      tx,
    );
    if (input.amount === 0)
      return { ok: true as const, skipped: true as const };
    const account = await ensureAccount(
      tx,
      input.organizationId,
      input.asset,
      input.brandId,
    );
    const [updated] = await tx
      .update(balanceAccounts)
      .set({
        balance: sql`${balanceAccounts.balance} - ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(balanceAccounts.id, account.id),
          sql`${balanceAccounts.balance} >= ${input.amount}`,
        ),
      )
      .returning();
    if (!updated)
      return { ok: false as const, code: "INSUFFICIENT_BALANCE" as const };
    const [transaction] = await tx
      .insert(balanceTransactions)
      .values({
        organizationId: input.organizationId,
        asset: input.asset,
        operation: "consume",
        amount: input.amount,
        sourceAccountId: account.id,
        sourceBalanceAfter: updated.balance,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        actorUserId: input.actorUserId,
      })
      .returning();
    return {
      ok: true as const,
      transaction: transaction!,
      replayed: false as const,
    };
  };
  return executor ? execute(executor) : db.transaction(execute);
}

export async function restoreBalance(
  input: {
    organizationId: string;
    brandId?: string;
    asset: BalanceAsset;
    amount: number;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
    reason: string;
    actorUserId?: string;
  },
  executor?: DatabaseTransaction,
) {
  const execute = async (tx: DatabaseTransaction) => {
    await lockIdempotencyKey(tx, input.organizationId, input.idempotencyKey);
    const [replay] = await tx
      .select()
      .from(balanceTransactions)
      .where(
        and(
          eq(balanceTransactions.organizationId, input.organizationId),
          eq(balanceTransactions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (replay) return replay;
    const account = await ensureAccount(
      tx,
      input.organizationId,
      input.asset,
      input.brandId,
    );
    const [updated] = await tx
      .update(balanceAccounts)
      .set({
        balance: sql`${balanceAccounts.balance} + ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(balanceAccounts.id, account.id))
      .returning();
    const [transaction] = await tx
      .insert(balanceTransactions)
      .values({
        organizationId: input.organizationId,
        asset: input.asset,
        operation: "restore",
        amount: input.amount,
        targetAccountId: account.id,
        targetBalanceAfter: updated!.balance,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        actorUserId: input.actorUserId,
      })
      .returning();
    return transaction!;
  };
  return executor ? execute(executor) : db.transaction(execute);
}

export function listBalances(organizationId: string) {
  return db
    .select()
    .from(balanceAccounts)
    .where(eq(balanceAccounts.organizationId, organizationId))
    .orderBy(balanceAccounts.asset, balanceAccounts.brandId);
}
export function listAllBalances() {
  return db
    .select()
    .from(balanceAccounts)
    .orderBy(
      balanceAccounts.organizationId,
      balanceAccounts.asset,
      balanceAccounts.brandId,
    );
}
const balanceTransactionWhere = (input: BalanceTransactionFilters) =>
  and(
    input.organizationId
      ? eq(balanceTransactions.organizationId, input.organizationId)
      : undefined,
    input.userId
      ? eq(balanceTransactions.actorUserId, input.userId)
      : undefined,
    input.asset ? eq(balanceTransactions.asset, input.asset) : undefined,
    input.operation
      ? eq(balanceTransactions.operation, input.operation)
      : undefined,
  );

const balanceTransactionSelection = {
  ...getTableColumns(balanceTransactions),
  organizationName: organizations.name,
  actorName: users.name,
  actorUsername: users.username,
};

export function listBalanceTransactions(
  input: BalanceTransactionFilters & { limit?: number },
) {
  return db
    .select(balanceTransactionSelection)
    .from(balanceTransactions)
    .innerJoin(
      organizations,
      eq(organizations.id, balanceTransactions.organizationId),
    )
    .leftJoin(users, eq(users.id, balanceTransactions.actorUserId))
    .where(balanceTransactionWhere(input))
    .orderBy(desc(balanceTransactions.createdAt))
    .limit(input.limit ?? 100);
}

// @project-doc docs/architecture/platform_administration.md#asset_directory
export async function listAllBalanceTransactions(
  input: BalanceTransactionFilters & { page: number; pageSize: number },
  userId: string,
) {
  const where = balanceTransactionWhere(input);
  const source = alias(balanceAccounts, "ledger_source"),
    target = alias(balanceAccounts, "ledger_target");
  return withPlatformDbContext(
    { userId },
    async (tx) => {
      const [count] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(balanceTransactions)
        .where(where);
      const total = count?.value ?? 0,
        pages = Math.ceil(total / input.pageSize),
        page = Math.min(input.page, Math.max(1, pages));
      const list = await tx
        .select({
          ...balanceTransactionSelection,
          sourceBrandId: source.brandId,
          targetBrandId: target.brandId,
        })
        .from(balanceTransactions)
        .innerJoin(
          organizations,
          eq(organizations.id, balanceTransactions.organizationId),
        )
        .leftJoin(users, eq(users.id, balanceTransactions.actorUserId))
        .leftJoin(
          source,
          and(
            eq(source.id, balanceTransactions.sourceAccountId),
            eq(source.organizationId, balanceTransactions.organizationId),
          ),
        )
        .leftJoin(
          target,
          and(
            eq(target.id, balanceTransactions.targetAccountId),
            eq(target.organizationId, balanceTransactions.organizationId),
          ),
        )
        .where(where)
        .orderBy(
          desc(balanceTransactions.createdAt),
          desc(balanceTransactions.id),
        )
        .limit(input.pageSize)
        .offset((page - 1) * input.pageSize);
      return {
        list,
        pagination: { page, pageSize: input.pageSize, total, pages },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

// @project-doc docs/domains/balance_and_publication.md#point_usage
export async function getPointUsage(input: PointUsageFilters) {
  // Read balances, totals and the page from one snapshot during concurrent billing.
  return db.transaction(
    async (tx) => {
      const [balances] = await tx
        .select({
          balance: sql<number>`coalesce(sum(case when ${balanceAccounts.brandId} is not null then ${balanceAccounts.balance} else 0 end), 0)::float8`,
          organizationBalance: sql<number>`coalesce(sum(case when ${balanceAccounts.brandId} is null then ${balanceAccounts.balance} else 0 end), 0)::float8`,
        })
        .from(balanceAccounts)
        .where(
          and(
            eq(balanceAccounts.organizationId, input.organizationId),
            eq(balanceAccounts.asset, "answerbit_points"),
            input.brandId
              ? or(
                  eq(balanceAccounts.brandId, input.brandId),
                  isNull(balanceAccounts.brandId),
                )
              : undefined,
          ),
        );

      // A consumption belongs to its source, and a refund to its original target.
      const usageAccount = sql`case when ${balanceTransactions.operation} = 'consume' then ${balanceTransactions.sourceAccountId} else ${balanceTransactions.targetAccountId} end`;
      const periodWhere = and(
        eq(balanceTransactions.organizationId, input.organizationId),
        eq(balanceTransactions.asset, "answerbit_points"),
        eq(balanceAccounts.organizationId, input.organizationId),
        eq(balanceAccounts.asset, "answerbit_points"),
        input.brandId
          ? eq(balanceAccounts.brandId, input.brandId)
          : isNotNull(balanceAccounts.brandId),
        inArray(balanceTransactions.operation, ["consume", "restore"]),
        gte(balanceTransactions.createdAt, input.beginAt),
        lt(balanceTransactions.createdAt, input.endAtExclusive),
      );
      const listWhere = and(
        periodWhere,
        input.operation
          ? eq(balanceTransactions.operation, input.operation)
          : undefined,
      );
      const [summary] = await tx
        .select({
          consumed: sql<number>`coalesce(sum(case when ${balanceTransactions.operation} = 'consume' then ${balanceTransactions.amount} else 0 end), 0)::float8`,
          restored: sql<number>`coalesce(sum(case when ${balanceTransactions.operation} = 'restore' then ${balanceTransactions.amount} else 0 end), 0)::float8`,
          transactionCount: sql<number>`count(*)::int`,
        })
        .from(balanceTransactions)
        .innerJoin(balanceAccounts, eq(balanceAccounts.id, usageAccount))
        .where(periodWhere);
      const list = await tx
        .select({
          ...balanceTransactionSelection,
          brandId: balanceAccounts.brandId,
          brandName: answerbitBrandMappings.brandName,
        })
        .from(balanceTransactions)
        .innerJoin(balanceAccounts, eq(balanceAccounts.id, usageAccount))
        .innerJoin(
          organizations,
          eq(organizations.id, balanceTransactions.organizationId),
        )
        .leftJoin(users, eq(users.id, balanceTransactions.actorUserId))
        .leftJoin(
          answerbitBrandMappings,
          and(
            eq(answerbitBrandMappings.organizationId, input.organizationId),
            eq(answerbitBrandMappings.brandId, balanceAccounts.brandId),
          ),
        )
        .where(listWhere)
        .orderBy(
          desc(balanceTransactions.createdAt),
          desc(balanceTransactions.id),
        )
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);
      const [count] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(balanceTransactions)
        .innerJoin(balanceAccounts, eq(balanceAccounts.id, usageAccount))
        .where(listWhere);
      const total = count?.value ?? 0;
      return {
        balance: balances?.balance ?? 0,
        organizationBalance: balances?.organizationBalance ?? 0,
        summary: summary ?? { consumed: 0, restored: 0, transactionCount: 0 },
        list,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          pages: Math.ceil(total / input.pageSize),
        },
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
export async function getFeaturePointCost(featureCode: string) {
  const [row] = await db
    .select()
    .from(featurePointCosts)
    .where(eq(featurePointCosts.featureCode, featureCode))
    .limit(1);
  return row?.points ?? 0;
}
export async function setFeaturePointCost(input: {
  featureCode: string;
  points: number;
  description: string;
  updatedBy: string;
}) {
  const [row] = await db
    .insert(featurePointCosts)
    .values(input)
    .onConflictDoUpdate({
      target: featurePointCosts.featureCode,
      set: {
        points: input.points,
        description: input.description,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}
export function listFeaturePointCosts() {
  return db
    .select()
    .from(featurePointCosts)
    .orderBy(featurePointCosts.featureCode);
}

/** Manual debit: immutable adjustment, conditional debit and idempotent replay. */
export async function deductBalance(
  input: {
    organizationId: string;
    brandId?: string;
    asset: BalanceAsset;
    amount: number;
    reason: string;
    idempotencyKey: string;
    actorUserId: string;
  },
  onCommitted?: (
    tx: DatabaseTransaction,
    transaction: typeof balanceTransactions.$inferSelect,
  ) => Promise<void>,
) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw new Error("INVALID_DEDUCTION_AMOUNT");
  return db.transaction(async (tx) => {
    await lockIdempotencyKey(tx, input.organizationId, input.idempotencyKey);
    const [replay] = await tx
      .select()
      .from(balanceTransactions)
      .where(
        and(
          eq(balanceTransactions.organizationId, input.organizationId),
          eq(balanceTransactions.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    const [account] = await tx
      .select()
      .from(balanceAccounts)
      .where(accountWhere(input.organizationId, input.asset, input.brandId))
      .limit(1);
    if (replay) {
      if (
        replay.operation !== "adjust" ||
        replay.referenceType !== "admin_deduction" ||
        replay.sourceAccountId !== account?.id ||
        replay.amount !== input.amount ||
        replay.reason !== input.reason ||
        replay.actorUserId !== input.actorUserId
      )
        return { ok: false as const, code: "IDEMPOTENCY_CONFLICT" as const };
      return {
        ok: true as const,
        transaction: replay,
        replayed: true as const,
      };
    }
    if (!account)
      return { ok: false as const, code: "INSUFFICIENT_BALANCE" as const };
    const [updated] = await tx
      .update(balanceAccounts)
      .set({
        balance: sql`${balanceAccounts.balance} - ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(balanceAccounts.id, account.id),
          gte(balanceAccounts.balance, input.amount),
        ),
      )
      .returning();
    if (!updated)
      return { ok: false as const, code: "INSUFFICIENT_BALANCE" as const };
    const [transaction] = await tx
      .insert(balanceTransactions)
      .values({
        organizationId: input.organizationId,
        asset: input.asset,
        operation: "adjust",
        amount: input.amount,
        sourceAccountId: account.id,
        sourceBalanceAfter: updated.balance,
        referenceType: "admin_deduction",
        referenceId: account.id,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.actorUserId,
      })
      .returning();
    await onCommitted?.(tx, transaction!);
    return {
      ok: true as const,
      transaction: transaction!,
      replayed: false as const,
    };
  });
}
