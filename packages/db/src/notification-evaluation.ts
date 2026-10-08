import { createHash } from "node:crypto";
import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";
import { db } from "./client";
import type { DatabaseTransaction } from "./context";
import {
  answerbitBrandMappings,
  answerbitTeamBindings,
  notificationRules,
  notifications,
  organizations,
} from "./schema";

export type NotificationRuleSnapshot = Pick<
  typeof notificationRules.$inferSelect,
  | "id"
  | "organizationId"
  | "teamBindingId"
  | "brandId"
  | "type"
  | "metric"
  | "threshold"
  | "windowDays"
  | "cooldownMinutes"
  | "scopeKey"
  | "enabled"
>;

const currentRule = (rule: NotificationRuleSnapshot) =>
  and(
    eq(notificationRules.id, rule.id),
    eq(notificationRules.organizationId, rule.organizationId),
    eq(notificationRules.teamBindingId, rule.teamBindingId),
    rule.brandId === null
      ? isNull(notificationRules.brandId)
      : eq(notificationRules.brandId, rule.brandId),
    eq(notificationRules.type, rule.type),
    rule.metric === null
      ? isNull(notificationRules.metric)
      : eq(notificationRules.metric, rule.metric),
    eq(notificationRules.threshold, rule.threshold),
    rule.windowDays === null
      ? isNull(notificationRules.windowDays)
      : eq(notificationRules.windowDays, rule.windowDays),
    eq(notificationRules.cooldownMinutes, rule.cooldownMinutes),
    eq(notificationRules.scopeKey, rule.scopeKey),
    eq(notificationRules.enabled, true),
    rule.brandId === null
      ? undefined
      : sql`exists (select 1 from ${answerbitBrandMappings} where ${answerbitBrandMappings.organizationId} = ${notificationRules.organizationId} and ${answerbitBrandMappings.teamBindingId} = ${notificationRules.teamBindingId} and ${answerbitBrandMappings.brandId} = ${notificationRules.brandId})`,
  );

async function lockNotificationRule(
  tx: DatabaseTransaction,
  rule: NotificationRuleSnapshot,
) {
  // Share locks serialize final writes with enterprise freeze/expiry changes
  // and projection shutdown, without holding locks during upstream requests.
  const [organization] = await tx
    .select({
      status: organizations.status,
      serviceExpiresAt: organizations.serviceExpiresAt,
    })
    .from(organizations)
    .where(eq(organizations.id, rule.organizationId))
    .for("share")
    .limit(1);
  if (
    !organization ||
    organization.status !== "active" ||
    (organization.serviceExpiresAt &&
      organization.serviceExpiresAt <= new Date())
  )
    return undefined;
  const [team] = await tx
    .select({ status: answerbitTeamBindings.status })
    .from(answerbitTeamBindings)
    .where(
      and(
        eq(answerbitTeamBindings.id, rule.teamBindingId),
        eq(answerbitTeamBindings.organizationId, rule.organizationId),
      ),
    )
    .for("share")
    .limit(1);
  if (!team || team.status === "disabled") return undefined;
  const [current] = await tx
    .select()
    .from(notificationRules)
    .where(currentRule(rule))
    .for("update")
    .limit(1);
  // A rule/configuration lock may outlive the enterprise's validity window.
  if (
    organization.serviceExpiresAt &&
    organization.serviceExpiresAt <= new Date()
  )
    return undefined;
  return current;
}

// @project-doc docs/domains/geo_operations.md#notification_workflow
export async function isNotificationRuleEvaluable(
  rule: NotificationRuleSnapshot,
) {
  if (!rule.enabled) return false;
  const [current] = await db
    .select({ id: notificationRules.id })
    .from(notificationRules)
    .innerJoin(
      organizations,
      eq(organizations.id, notificationRules.organizationId),
    )
    .innerJoin(
      answerbitTeamBindings,
      and(
        eq(answerbitTeamBindings.id, notificationRules.teamBindingId),
        eq(
          answerbitTeamBindings.organizationId,
          notificationRules.organizationId,
        ),
      ),
    )
    .where(
      and(
        currentRule(rule),
        eq(organizations.status, "active"),
        sql`(${organizations.serviceExpiresAt} is null or ${organizations.serviceExpiresAt} > clock_timestamp())`,
        ne(answerbitTeamBindings.status, "disabled"),
      ),
    )
    .limit(1);
  return Boolean(current);
}

// @project-doc docs/domains/geo_operations.md#notification_workflow
export async function recordNotificationEvaluation(
  rule: NotificationRuleSnapshot,
  errorCode?: string,
) {
  if (!rule.enabled) return false;
  return db.transaction(
    async (tx) => {
      if (!(await lockNotificationRule(tx, rule))) return false;
      const [updated] = await tx
        .update(notificationRules)
        .set({
          lastEvaluatedAt: new Date(),
          lastEvaluationError: errorCode ?? null,
          updatedAt: new Date(),
        })
        .where(currentRule(rule))
        .returning({ id: notificationRules.id });
      return Boolean(updated);
    },
    { isolationLevel: "read committed" },
  );
}

// @project-doc docs/domains/geo_operations.md#notification_workflow
export async function publishRuleNotification(
  rule: NotificationRuleSnapshot,
  event: {
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
    payload: Record<string, unknown>;
    occurredAt?: Date;
  },
) {
  if (!rule.enabled) return undefined;
  return db.transaction(
    async (tx) => {
      const current = await lockNotificationRule(tx, rule);
      if (!current) return undefined;
      const now = event.occurredAt ?? new Date();
      const cutoff = new Date(now.getTime() - current.cooldownMinutes * 60_000);
      const [recent] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.ruleId, current.id),
            gte(notifications.occurredAt, cutoff),
          ),
        )
        .orderBy(desc(notifications.occurredAt))
        .limit(1);
      if (recent) return undefined;
      const bucket = Math.floor(
        now.getTime() / (current.cooldownMinutes * 60_000),
      );
      const eventKey = createHash("sha256")
        .update(`${current.id}:${bucket}`)
        .digest("hex");
      const [created] = await tx
        .insert(notifications)
        .values({
          organizationId: current.organizationId,
          ruleId: current.id,
          teamBindingId: current.teamBindingId,
          brandId: current.brandId,
          type: current.type,
          eventKey,
          ...event,
          occurredAt: now,
        })
        .onConflictDoNothing()
        .returning();
      return created;
    },
    { isolationLevel: "read committed" },
  );
}
