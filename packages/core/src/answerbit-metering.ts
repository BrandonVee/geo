/** Read-only official metering operations. They must not consume local points. */
export const answerBitMeteringOperations = [
  "/geo/billing/report/usage",
  "/geo/billing/subscription/get",
  "/geo/billing/credit/status",
  "/geo/billing/credit/usage",
  "/geo/billing/credit/trend",
  "/geo/billing/credit/rank",
  "/geo/billing/credit/bills",
  "/geo/billing/logs/list",
  "/geo/billing/quota/override/list",
] as const;
const answerBitMeteringOperationSet = new Set<string>(
  answerBitMeteringOperations,
);
export const isAnswerBitMeteringOperation = (operation: string) =>
  answerBitMeteringOperationSet.has(operation);

/**
 * Tencent defines credit status `total_amount` as the currently available
 * amount; `used_amount` is historical confirmed consumption and must not be
 * subtracted a second time.
 */
export const answerBitAvailableCredits = (status: { total_amount: number }) =>
  Math.max(0, status.total_amount);

export const answerBitCreditUtilization = (status: {
  total_amount: number;
  used_amount: number;
}) => {
  const available = answerBitAvailableCredits(status);
  const capacity = available + Math.max(0, status.used_amount);
  return capacity
    ? Math.min(100, (Math.max(0, status.used_amount) / capacity) * 100)
    : 0;
};
