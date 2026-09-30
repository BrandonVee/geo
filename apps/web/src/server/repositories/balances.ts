import {
  allocateBalance,
  answerbitBrandMappings,
  db,
  grantBalance,
  deductBalance,
  getBrandPointUsage,
  listFeaturePointCosts,
  listAllBalances,
  listAllBalanceTransactions,
  listBalanceTransactions,
  listBalances,
  setFeaturePointCost,
} from "@geo/db";
import { and, eq } from "drizzle-orm";

export const balanceRepository = {
  list: listBalances,
  all: listAllBalances,
  transactions: listBalanceTransactions,
  pointUsage: getBrandPointUsage,
  allTransactions: listAllBalanceTransactions,
  grant: grantBalance,
  deduct: deductBalance,
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
