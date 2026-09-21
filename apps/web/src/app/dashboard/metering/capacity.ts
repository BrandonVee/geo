export type CapacityQuota = {
  total_amount: number;
  used_amount: number;
};

export function projectCapacity(
  quota: CapacityQuota,
  expansionQuantity: number,
) {
  const currentLimit = Math.max(0, quota.total_amount);
  const createdCount = Math.max(0, quota.used_amount);
  const availableCount = Math.max(0, currentLimit - createdCount);
  const expansionCount = Math.max(0, Math.trunc(expansionQuantity));

  return {
    currentLimit,
    createdCount,
    availableCount,
    projectedLimit: currentLimit + expansionCount,
    projectedAvailableCount: availableCount + expansionCount,
    utilization:
      currentLimit > 0
        ? Math.min(100, (createdCount / currentLimit) * 100)
        : createdCount > 0
          ? 100
          : 0,
  };
}
