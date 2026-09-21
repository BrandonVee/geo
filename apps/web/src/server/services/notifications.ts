import type {
  NotificationListQuery,
  NotificationRuleInput,
} from "@geo/contracts";
import {
  classifyConnectionFailure,
  classifyMetricAnomaly,
  connectionFailureLookbackLimit,
  countConsecutiveFailures,
  hasPermission,
  type Role,
} from "@geo/core";
import type { AuditContext } from "@/server/audit/write-audit";
import { writeAudit } from "@/server/audit/write-audit";
import { ApiError, databaseErrorCode } from "@/server/http/errors";
import { assertOrganizationFeatureEnabled } from "@/server/permissions/organization-features";
import { brandRepository } from "@/server/repositories/brands";
import { organizationRepository } from "@/server/repositories/organizations";
import {
  notificationRepository,
  type StoredNotificationRule,
} from "@/server/repositories/notifications";
import { organizationService } from "./organizations";

async function readScope(organizationId: string, userId: string) {
  const membership = await organizationRepository.findMembershipRole(
    organizationId,
    userId,
  );
  if (!membership || membership.status !== "active")
    throw new ApiError(404, "ORGANIZATION_NOT_FOUND", "企业不存在");
  if (membership.organizationStatus !== "active")
    throw new ApiError(403, "ORGANIZATION_SUSPENDED", "企业已被平台冻结或关闭");
  await assertOrganizationFeatureEnabled(
    organizationId,
    userId,
    "notification.read",
  );
  if (
    membership.role &&
    hasPermission(membership.role as Role, "notification.read")
  )
    return { unrestricted: true };
  const accesses = (
    await notificationRepository.listAccesses(organizationId, userId)
  ).filter((item) => hasPermission(item.role as Role, "notification.read"));
  if (!accesses.length)
    throw new ApiError(403, "PERMISSION_DENIED", "没有读取通知的权限");
  return { unrestricted: false };
}

async function validateRule(input: NotificationRuleInput) {
  const team = await brandRepository.findTeam(
    input.organizationId,
    input.teamBindingId,
  );
  if (!team)
    throw new ApiError(
      422,
      "TEAM_BINDING_NOT_FOUND",
      "通知规则对应的企业腾讯范围不存在或已停用",
    );
  if (
    input.type === "metric_anomaly" &&
    !(await brandRepository.findBrand(
      input.organizationId,
      input.teamBindingId,
      input.brandId,
    ))
  )
    throw new ApiError(
      422,
      "BRAND_NOT_FOUND",
      "通知规则对应的品牌尚未同步或不存在",
    );
}

const duplicate = (error: unknown): never => {
  if (databaseErrorCode(error) === "23505")
    throw new ApiError(
      409,
      "NOTIFICATION_RULE_EXISTS",
      "相同类型和范围的通知规则已存在",
    );
  throw error;
};

export const notificationService = {
  async list(input: NotificationListQuery, userId: string) {
    const scope = await readScope(input.organizationId, userId);
    return notificationRepository.list(
      input.organizationId,
      userId,
      input,
      scope.unrestricted,
    );
  },
  async listRules(organizationId: string, userId: string) {
    await organizationService.authorize(
      organizationId,
      userId,
      "notification.manage",
    );
    return notificationRepository.listRules(organizationId);
  },
  async createRule(
    input: NotificationRuleInput,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      input.organizationId,
      userId,
      "notification.manage",
    );
    await validateRule(input);
    try {
      const rule = await notificationRepository.createRule(input, userId);
      await writeAudit(audit, {
        operation: "notification-rule.create",
        resourceType: "notification_rule",
        resourceId: rule.id,
        summary: `创建通知规则：${rule.type}`,
      });
      return rule;
    } catch (error) {
      return duplicate(error);
    }
  },
  async replaceRule(
    id: string,
    input: NotificationRuleInput,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      input.organizationId,
      userId,
      "notification.manage",
    );
    if (!(await notificationRepository.findRule(id, input.organizationId)))
      throw new ApiError(404, "NOTIFICATION_RULE_NOT_FOUND", "通知规则不存在");
    await validateRule(input);
    try {
      const rule = await notificationRepository.replaceRule(id, input, userId);
      await writeAudit(audit, {
        operation: "notification-rule.update",
        resourceType: "notification_rule",
        resourceId: id,
        summary: `更新通知规则：${rule!.type}`,
      });
      return rule!;
    } catch (error) {
      return duplicate(error);
    }
  },
  async disableRule(
    id: string,
    organizationId: string,
    userId: string,
    audit: AuditContext,
  ) {
    await organizationService.authorize(
      organizationId,
      userId,
      "notification.manage",
    );
    const rule = await notificationRepository.disableRule(
      id,
      organizationId,
      userId,
    );
    if (!rule)
      throw new ApiError(404, "NOTIFICATION_RULE_NOT_FOUND", "通知规则不存在");
    await writeAudit(audit, {
      operation: "notification-rule.disable",
      resourceType: "notification_rule",
      resourceId: id,
      summary: `停用通知规则：${rule.type}`,
    });
  },
  async setRead(
    id: string,
    organizationId: string,
    read: boolean,
    userId: string,
  ) {
    const scope = await readScope(organizationId, userId);
    if (
      !(await notificationRepository.canAccessNotification(
        id,
        organizationId,
        userId,
        scope.unrestricted,
      ))
    )
      throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "通知不存在");
    return notificationRepository.setRead(id, userId, read);
  },
};

async function safeEvaluate(
  rule: StoredNotificationRule | undefined,
  evaluate: (rule: StoredNotificationRule) => Promise<void>,
) {
  if (!rule) return;
  try {
    await evaluate(rule);
    await notificationRepository.recordEvaluation(rule.id);
  } catch (error) {
    const code =
      error instanceof Error
        ? error.message.slice(0, 128)
        : "NOTIFICATION_EVALUATION_FAILED";
    await notificationRepository
      .recordEvaluation(rule.id, code)
      .catch(() => undefined);
    console.error(
      JSON.stringify({
        event: "notification.evaluate.failed",
        ruleId: rule.id,
        error: code,
      }),
    );
  }
}

export async function evaluateMetricAnomaly(
  organizationId: string,
  teamBindingId: string,
  brandId: string,
  result: {
    exposure: { value: number; fluctuation: number };
    score: { value: number; fluctuation: number };
    avg_rank: { value: number; fluctuation: number };
  },
) {
  const rule = await notificationRepository.findEnabledRule(
    organizationId,
    teamBindingId,
    "metric_anomaly",
    brandId,
  );
  await safeEvaluate(rule, async (current) => {
    if (!current.metric) return;
    const sample = result[current.metric];
    const classification = classifyMetricAnomaly(
      current.metric,
      sample.fluctuation,
      current.threshold,
    );
    if (!classification.anomalous) return;
    const names = {
      exposure: "品牌提及率",
      score: "GEO 得分",
      avg_rank: "平均排名",
    } as const;
    const direction = classification.direction === "up" ? "上升" : "下降";
    await notificationRepository.publish(current, {
      severity: classification.severity,
      title: `${names[current.metric]}异常`,
      message: `${names[current.metric]}${direction} ${Math.abs(sample.fluctuation).toFixed(1)}%，超过 ${current.threshold}% 阈值。`,
      payload: {
        metric: current.metric,
        value: sample.value,
        fluctuation: sample.fluctuation,
        threshold: current.threshold,
        windowDays: current.windowDays,
      },
    });
  });
}

export async function evaluateConnectionFailure(
  organizationId: string,
  teamBindingId: string,
  connectionId: string,
  errorCode: string,
) {
  const rule = await notificationRepository.findEnabledRule(
    organizationId,
    teamBindingId,
    "connection_failure",
  );
  await safeEvaluate(rule, async (current) => {
    const checks = await notificationRepository.recentConnectionChecks(
      connectionId,
      connectionFailureLookbackLimit(current.threshold),
    );
    const classification = classifyConnectionFailure(
      countConsecutiveFailures(checks),
      current.threshold,
    );
    if (!classification.triggered) return;
    await notificationRepository.publish(current, {
      severity: classification.severity,
      title: "AnswerBit 连接连续失败",
      message: `腾讯接入已连续失败 ${classification.consecutiveFailures} 次，请检查平台接入配置与上游服务状态。`,
      payload: {
        consecutiveFailures: classification.consecutiveFailures,
        threshold: current.threshold,
        errorCode,
      },
    });
  });
}
