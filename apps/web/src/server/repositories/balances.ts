import {
  allocateBalance,
  answerbitBrandMappings,
  db,
  grantBalance,
  deductBalance,
  getPointUsage,
  listFeaturePointCosts,
  listAllBalances,
  listAllBalanceTransactions,
  listBalanceTransactions,
  listBalances,
  setFeaturePointCost,
  balanceAccounts,
  balanceTransactions,
  withPlatformDbContext,
} from "@geo/db";
import { and, eq, sql } from "drizzle-orm";
import { listPlatformOrganizations } from "./organization-directory";
import type { AdminOrganizationPageQuery } from "@geo/contracts";

export const balanceRepository = {
  organizationBalances: (input: AdminOrganizationPageQuery, userId: string) =>
    listPlatformOrganizations(input, userId, true),
  list: listBalances,
  all: listAllBalances,
  transactions: listBalanceTransactions,
  pointUsage: getPointUsage,
  allTransactions: listAllBalanceTransactions,
  grant: grantBalance,
  deduct: deductBalance,
  // @project-doc docs/domains/balance_and_publication.md#balance_invariants
  async confirmation(
    input: { organizationId: string; idempotencyKey: string },
    userId: string,
  ) {
    return withPlatformDbContext({ userId }, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${input.idempotencyKey}))`,
      );
      const [row] = await tx
        .select({
          transaction: balanceTransactions,
          brandId: balanceAccounts.brandId,
        })
        .from(balanceTransactions)
        .leftJoin(
          balanceAccounts,
          sql`${balanceAccounts.id} = coalesce(${balanceTransactions.sourceAccountId}, ${balanceTransactions.targetAccountId})`,
        )
        .where(
          and(
            eq(balanceTransactions.organizationId, input.organizationId),
            eq(balanceTransactions.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      return row ? { ...row.transaction, brandId: row.brandId } : null;
    });
  },
  allocate: allocateBalance,
  pointCosts: listFeaturePointCosts,
  setPointCost: setFeaturePointCost,
  async brandExists(organizationId: string, brandId: string) {
    const [row] = await db
      .select({ id: answerbitBrandMappings.id })
      .from(answerbitBrandMappings)
      .where(
        and(
          eq(answerbitBrandMappings.organizationId, organizationId),
          eq(answerbitBrandMappings.brandId, brandId),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
};
