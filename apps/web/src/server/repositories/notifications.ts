import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  answerbitApiCalls,
  answerbitBrandMappings,
  answerbitTeamBindings,
  brandAccess,
  db,
  notificationReads,
  notificationRules,
  notifications,
} from "@geo/db";
import type { NotificationRuleInput } from "@geo/contracts";

export type StoredNotificationRule = typeof notificationRules.$inferSelect;

const scopeKey = (
  input: Pick<NotificationRuleInput, "teamBindingId"> & { brandId?: string },
) => `${input.teamBindingId}${input.brandId ? `:${input.brandId}` : ""}`;

const ruleValues = (input: NotificationRuleInput, userId: string) => ({
  organizationId: input.organizationId,
  teamBindingId: input.teamBindingId,
  brandId: input.type === "metric_anomaly" ? input.brandId : null,
  type: input.type,
  metric: input.type === "metric_anomaly" ? input.metric : null,
  threshold: input.threshold,
  windowDays: input.type === "metric_anomaly" ? input.windowDays : null,
  cooldownMinutes: input.cooldownMinutes,
  scopeKey: scopeKey(input),
  enabled: input.enabled,
  updatedBy: userId,
  updatedAt: new Date(),
});

const projection = {
  id: notifications.id,
  organizationId: notifications.organizationId,
  teamBindingId: notifications.teamBindingId,
  brandId: notifications.brandId,
  type: notifications.type,
  severity: notifications.severity,
  title: notifications.title,
  message: notifications.message,
  payload: notifications.payload,
  occurredAt: notifications.occurredAt,
  createdAt: notifications.createdAt,
  readAt: notificationReads.readAt,
};

export const notificationRepository = {
  listRules(organizationId: string) {
    return db
      .select({
        id: notificationRules.id,
        organizationId: notificationRules.organizationId,
        teamBindingId: notificationRules.teamBindingId,
        teamName: answerbitTeamBindings.displayName,
        teamId: answerbitTeamBindings.teamId,
        brandId: notificationRules.brandId,
        brandName: answerbitBrandMappings.brandName,
        type: notificationRules.type,
        metric: notificationRules.metric,
        threshold: notificationRules.threshold,
        windowDays: notificationRules.windowDays,
        cooldownMinutes: notificationRules.cooldownMinutes,
        enabled: notificationRules.enabled,
        lastEvaluatedAt: notificationRules.lastEvaluatedAt,
        lastEvaluationError: notificationRules.lastEvaluationError,
        createdAt: notificationRules.createdAt,
        updatedAt: notificationRules.updatedAt,
      })
      .from(notificationRules)
      .innerJoin(
        answerbitTeamBindings,
        eq(answerbitTeamBindings.id, notificationRules.teamBindingId),
      )
      .leftJoin(
        answerbitBrandMappings,
        and(
          eq(
            answerbitBrandMappings.organizationId,
            notificationRules.organizationId,
          ),
          eq(
            answerbitBrandMappings.teamBindingId,
            notificationRules.teamBindingId,
          ),
          eq(answerbitBrandMappings.brandId, notificationRules.brandId),
        ),
      )
      .where(eq(notificationRules.organizationId, organizationId))
      .orderBy(desc(notificationRules.updatedAt));
  },
  async findRule(id: string, organizationId: string) {
    const [rule] = await db
      .select()
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.id, id),
          eq(notificationRules.organizationId, organizationId),
        ),
      )
      .limit(1);
    return rule;
  },
  async createRule(input: NotificationRuleInput, userId: string) {
    const [rule] = await db
      .insert(notificationRules)
      .values(ruleValues(input, userId))
      .returning();
    return rule;
  },
  async replaceRule(id: string, input: NotificationRuleInput, userId: string) {
    const [rule] = await db
      .update(notificationRules)
      .set(ruleValues(input, userId))
      .where(
        and(
          eq(notificationRules.id, id),
          eq(notificationRules.organizationId, input.organizationId),
        ),
      )
      .returning();
    return rule;
  },
  async disableRule(id: string, organizationId: string, userId: string) {
    const [rule] = await db
      .update(notificationRules)
      .set({ enabled: false, updatedBy: userId, updatedAt: new Date() })
      .where(
        and(
          eq(notificationRules.id, id),
          eq(notificationRules.organizationId, organizationId),
        ),
      )
      .returning();
    return rule;
  },
  async findEnabledRule(
    organizationId: string,
    teamBindingId: string,
    type: StoredNotificationRule["type"],
    brandId?: string,
  ) {
    const [rule] = await db
      .select()
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.organizationId, organizationId),
          eq(notificationRules.teamBindingId, teamBindingId),
          eq(notificationRules.type, type),
          eq(notificationRules.enabled, true),
          brandId
            ? eq(notificationRules.brandId, brandId)
            : isNull(notificationRules.brandId),
        ),
      )
      .limit(1);
    return rule;
  },
  async recordEvaluation(ruleId: string, errorCode?: string) {
    await db
      .update(notificationRules)
      .set({
        lastEvaluatedAt: new Date(),
        lastEvaluationError: errorCode ?? null,
        updatedAt: new Date(),
      })
      .where(eq(notificationRules.id, ruleId));
  },
  async recentConnectionChecks(connectionId: string, limit: number) {
    return db
      .select({ status: answerbitApiCalls.status })
      .from(answerbitApiCalls)
      .where(
        and(
          eq(answerbitApiCalls.connectionId, connectionId),
          eq(answerbitApiCalls.operation, "/geo/query/brand"),
        ),
      )
      .orderBy(desc(answerbitApiCalls.createdAt))
      .limit(limit);
  },
  async publish(
    rule: StoredNotificationRule,
    event: {
      severity: "info" | "warning" | "critical";
      title: string;
      message: string;
      payload: Record<string, unknown>;
      occurredAt?: Date;
    },
  ) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${rule.id}))`);
      const now = event.occurredAt ?? new Date();
      const cutoff = new Date(now.getTime() - rule.cooldownMinutes * 60_000);
      const [recent] = await tx
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.ruleId, rule.id),
            gte(notifications.occurredAt, cutoff),
          ),
        )
        .orderBy(desc(notifications.occurredAt))
        .limit(1);
      if (recent) return undefined;
      const bucket = Math.floor(
        now.getTime() / (rule.cooldownMinutes * 60_000),
      );
      const eventKey = createHash("sha256")
        .update(`${rule.id}:${bucket}`)
        .digest("hex");
      const [created] = await tx
        .insert(notifications)
        .values({
          organizationId: rule.organizationId,
          ruleId: rule.id,
          teamBindingId: rule.teamBindingId,
          brandId: rule.brandId,
          type: rule.type,
          eventKey,
          ...event,
          occurredAt: now,
        })
        .onConflictDoNothing()
        .returning();
      return created;
    });
  },
  listAccesses(organizationId: string, userId: string) {
    return db
      .select()
      .from(brandAccess)
      .where(
        and(
          eq(brandAccess.organizationId, organizationId),
          eq(brandAccess.userId, userId),
        ),
      );
  },
  async list(
    organizationId: string,
    userId: string,
    input: { page: number; pageSize: number; unreadOnly: boolean },
    unrestricted: boolean,
  ) {
    const offset = (input.page - 1) * input.pageSize;
    const readJoin = and(
      eq(notificationReads.notificationId, notifications.id),
      eq(notificationReads.userId, userId),
    );
    const baseConditions = [
      eq(notifications.organizationId, organizationId),
      input.unreadOnly ? isNull(notificationReads.readAt) : undefined,
    ];
    if (unrestricted) {
      const [list, [total], [unread]] = await Promise.all([
        db
          .select(projection)
          .from(notifications)
          .leftJoin(notificationReads, readJoin)
          .where(and(...baseConditions))
          .orderBy(desc(notifications.createdAt))
          .limit(input.pageSize)
          .offset(offset),
        db
          .select({ value: count(notifications.id) })
          .from(notifications)
          .leftJoin(notificationReads, readJoin)
          .where(and(...baseConditions)),
        db
          .select({ value: count(notifications.id) })
          .from(notifications)
          .leftJoin(notificationReads, readJoin)
          .where(
            and(
              eq(notifications.organizationId, organizationId),
              isNull(notificationReads.readAt),
            ),
          ),
      ]);
      return {
        list,
        total: Number(total.value),
        unreadCount: Number(unread.value),
        page: input.page,
        pageSize: input.pageSize,
      };
    }
    const accessJoin = and(
      eq(brandAccess.organizationId, notifications.organizationId),
      eq(brandAccess.teamBindingId, notifications.teamBindingId),
      eq(brandAccess.brandId, notifications.brandId),
      eq(brandAccess.userId, userId),
    );
    const [list, [total], [unread]] = await Promise.all([
      db
        .select(projection)
        .from(notifications)
        .innerJoin(brandAccess, accessJoin)
        .leftJoin(notificationReads, readJoin)
        .where(and(...baseConditions))
        .orderBy(desc(notifications.createdAt))
        .limit(input.pageSize)
        .offset(offset),
      db
        .select({ value: count(notifications.id) })
        .from(notifications)
        .innerJoin(brandAccess, accessJoin)
        .leftJoin(notificationReads, readJoin)
        .where(and(...baseConditions)),
      db
        .select({ value: count(notifications.id) })
        .from(notifications)
        .innerJoin(brandAccess, accessJoin)
        .leftJoin(notificationReads, readJoin)
        .where(
          and(
            eq(notifications.organizationId, organizationId),
            isNull(notificationReads.readAt),
          ),
        ),
    ]);
    return {
      list,
      total: Number(total.value),
      unreadCount: Number(unread.value),
      page: input.page,
      pageSize: input.pageSize,
    };
  },
  async canAccessNotification(
    id: string,
    organizationId: string,
    userId: string,
    unrestricted: boolean,
  ) {
    if (unrestricted) {
      const [row] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.organizationId, organizationId),
          ),
        )
        .limit(1);
      return Boolean(row);
    }
    const [row] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .innerJoin(
        brandAccess,
        and(
          eq(brandAccess.organizationId, notifications.organizationId),
          eq(brandAccess.teamBindingId, notifications.teamBindingId),
          eq(brandAccess.brandId, notifications.brandId),
          eq(brandAccess.userId, userId),
        ),
      )
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.organizationId, organizationId),
        ),
      )
      .limit(1);
    return Boolean(row);
  },
  async setRead(notificationId: string, userId: string, read: boolean) {
    if (!read) {
      await db
        .delete(notificationReads)
        .where(
          and(
            eq(notificationReads.notificationId, notificationId),
            eq(notificationReads.userId, userId),
          ),
        );
      return null;
    }
    const [receipt] = await db
      .insert(notificationReads)
      .values({ notificationId, userId })
      .onConflictDoUpdate({
        target: [notificationReads.notificationId, notificationReads.userId],
        set: { readAt: new Date() },
      })
      .returning();
    return receipt;
  },
};
