import type { answerBitDashboardMetricsSchema } from "@geo/contracts";
import {
  answerBitAvailableCredits,
  classifyConnectionFailure,
  classifyMetricAnomaly,
  connectionFailureLookbackLimit,
  countConsecutiveFailures,
  notificationMetricPeriod,
} from "@geo/core";
import {
  answerbitApiCalls,
  answerbitBrandMappings,
  answerbitCredentialAssignments,
  answerbitTeamBindings,
  balanceAccounts,
  db,
  isNotificationRuleEvaluable,
  notificationRules,
  publishRuleNotification,
  recordNotificationEvaluation,
} from "@geo/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { runtimeTaskErrorCode } from "./runtime-task";

type NotificationRule = typeof notificationRules.$inferSelect;
async function publishNotification(
  rule: NotificationRule,
  event: {
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
    payload: Record<string, unknown>;
  },
) {
  return Boolean(await publishRuleNotification(rule, event));
}
export type NotificationEvaluationItem = {
  rule: NotificationRule;
  team: typeof answerbitTeamBindings.$inferSelect;
};

// @project-doc docs/domains/geo_operations.md#notification_workflow
export async function evaluateNotificationRules(
  rulesToEvaluate: readonly NotificationEvaluationItem[],
  fetchMetrics: (
    rule: NotificationRule,
    period: { beginDate: string; endDate: string },
  ) => Promise<ReturnType<typeof answerBitDashboardMetricsSchema.parse>>,
) {
  let evaluated = 0;
  let emitted = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of rulesToEvaluate) {
    const { rule, team } = item;
    try {
      if (!(await isNotificationRuleEvaluable(rule))) {
        skipped += 1;
        continue;
      }
      if (rule.type === "low_credits") {
        const [account] = await db
          .select({ balance: balanceAccounts.balance })
          .from(balanceAccounts)
          .innerJoin(
            answerbitBrandMappings,
            and(
              eq(
                answerbitBrandMappings.organizationId,
                balanceAccounts.organizationId,
              ),
              eq(answerbitBrandMappings.brandId, balanceAccounts.brandId),
            ),
          )
          .where(
            and(
              eq(balanceAccounts.organizationId, rule.organizationId),
              eq(balanceAccounts.asset, "answerbit_points"),
            ),
          )
          .limit(1);
        const available = answerBitAvailableCredits({
          total_amount: account?.balance ?? 0,
        });
        if (
          available <= rule.threshold &&
          (await publishNotification(rule, {
            severity: available === 0 ? "critical" : "warning",
            title:
              available === 0 ? "AnswerBit 积分已耗尽" : "AnswerBit 积分不足",
            message: `当前品牌可用平台积分 ${available.toLocaleString("zh-CN")}，已达到企业配置的 ${rule.threshold.toLocaleString("zh-CN")} 阈值。`,
            payload: {
              available,
              asset: "answerbit_points",
              scope: "brand",
              threshold: rule.threshold,
            },
          }))
        )
          emitted += 1;
      } else if (rule.type === "connection_failure") {
        const teamCredentials = await db
          .select({ connectionId: answerbitCredentialAssignments.connectionId })
          .from(answerbitCredentialAssignments)
          .where(eq(answerbitCredentialAssignments.teamBindingId, team.id));
        const connectionIds = [
          ...new Set([
            team.connectionId,
            ...teamCredentials.map((credential) => credential.connectionId),
          ]),
        ];
        const checks = connectionIds.length
          ? await db
              .select({
                status: answerbitApiCalls.status,
                errorCode: answerbitApiCalls.errorCode,
              })
              .from(answerbitApiCalls)
              .where(
                and(
                  eq(answerbitApiCalls.organizationId, rule.organizationId),
                  inArray(answerbitApiCalls.connectionId, connectionIds),
                  gte(
                    answerbitApiCalls.createdAt,
                    new Date(Date.now() - 24 * 60 * 60_000),
                  ),
                ),
              )
              .orderBy(desc(answerbitApiCalls.createdAt))
              .limit(connectionFailureLookbackLimit(rule.threshold))
          : [];
        const consecutive =
          team.status === "invalid"
            ? Math.max(rule.threshold, countConsecutiveFailures(checks))
            : countConsecutiveFailures(checks);
        const classification = classifyConnectionFailure(
          consecutive,
          rule.threshold,
        );
        if (
          classification.triggered &&
          (await publishNotification(rule, {
            severity: classification.severity,
            title: "AnswerBit 连接连续失败",
            message: `最近业务调用连续失败 ${classification.consecutiveFailures} 次，请检查 API Key、TeamID 与上游服务状态。`,
            payload: {
              consecutiveFailures: classification.consecutiveFailures,
              threshold: rule.threshold,
              errorCode:
                team.status === "invalid"
                  ? (team.lastErrorCode ?? "ANSWERBIT_CONNECTION_INVALID")
                  : (checks[0]?.errorCode ?? "ANSWERBIT_CONNECTION_FAILED"),
            },
          }))
        )
          emitted += 1;
      } else {
        if (!rule.brandId || !rule.metric || !rule.windowDays)
          throw new Error("INVALID_METRIC_RULE");
        const result = await fetchMetrics(
          rule,
          notificationMetricPeriod(rule.windowDays),
        );
        const { value, fluctuation } = result[rule.metric];
        const classification = classifyMetricAnomaly(
          rule.metric,
          fluctuation,
          rule.threshold,
        );
        if (classification.anomalous) {
          const names = {
            exposure: "品牌提及率",
            score: "GEO 得分",
            avg_rank: "平均排名",
          } as const;
          const direction = classification.direction === "up" ? "上升" : "下降";
          if (
            await publishNotification(rule, {
              severity: classification.severity,
              title: `${names[rule.metric]}异常`,
              message: `${names[rule.metric]}${direction} ${Math.abs(fluctuation).toFixed(1)}%，超过 ${rule.threshold}% 阈值。`,
              payload: {
                metric: rule.metric,
                value,
                fluctuation,
                threshold: rule.threshold,
                windowDays: rule.windowDays,
              },
            })
          )
            emitted += 1;
        }
      }
      if (await recordNotificationEvaluation(rule)) evaluated += 1;
      else skipped += 1;
    } catch (error) {
      const errorCode = runtimeTaskErrorCode("notification-evaluation", error);
      let recorded = true;
      try {
        recorded = await recordNotificationEvaluation(rule, errorCode);
      } catch (healthError) {
        console.error(
          JSON.stringify({
            event: "notification-evaluation.health-write-failed",
            ruleId: rule.id,
            errorCode: runtimeTaskErrorCode(
              "notification-evaluation",
              healthError,
            ),
          }),
        );
      }
      if (recorded) {
        failed += 1;
        console.error(
          JSON.stringify({
            event: "notification-evaluation.rule-failed",
            ruleId: rule.id,
            errorCode,
          }),
        );
      } else skipped += 1;
    }
  }
  console.info(
    JSON.stringify({
      event: "notification-evaluation.completed",
      evaluated,
      emitted,
      failed,
      skipped,
    }),
  );
  if (failed > 0) throw new Error("NOTIFICATION_EVALUATION_PARTIAL_FAILURE");
  return { evaluated, emitted, failed, skipped };
}
