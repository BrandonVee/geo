import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, isNull, sql, lt } from "drizzle-orm";
import {
  answerbitApiCalls,
  answerbitBrandMappings,
  answerbitTeamBindings,
  brandAccess,
  db,
  notificationReads,
  notificationRules,
  notifications,
  withTenantDbContext,
  type DatabaseTransaction,
} from "@geo/db";
import type {
  NotificationRuleInput,
  NotificationRuleReplaceInput,
  NotificationReadAllInput,
  NotificationListQuery,
} from "@geo/contracts";

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

export function sameNotificationRule(
  row: StoredNotificationRule,
  input: NotificationRuleInput,
) {
  const values = ruleValues(input, row.updatedBy ?? "");
  return [
    "organizationId",
    "teamBindingId",
    "brandId",
    "type",
    "metric",
    "threshold",
    "windowDays",
    "cooldownMinutes",
    "scopeKey",
    "enabled",
  ].every(
    (key) =>
      row[key as keyof StoredNotificationRule] ===
      values[key as keyof typeof values],
  );
}
type CommitRule = (
  tx: DatabaseTransaction,
  rule: StoredNotificationRule,
) => Promise<void>;

const visibleNotices = (
  organizationId: string,
  userId: string,
  unrestricted: boolean,
) =>
  and(
    eq(notifications.organizationId, organizationId),
    unrestricted
      ? undefined
      : sql`exists (select 1 from ${brandAccess} where ${brandAccess.organizationId} = ${notifications.organizationId} and ${brandAccess.teamBindingId} = ${notifications.teamBindingId} and ${brandAccess.brandId} = ${notifications.brandId} and ${brandAccess.userId} = ${userId})`,
  );
const noticeFilters = (input: NotificationReadAllInput) =>
  and(
    input.type ? eq(notifications.type, input.type) : undefined,
    input.severity ? eq(notifications.severity, input.severity) : undefined,
    input.beginDate
      ? gte(
          notifications.occurredAt,
          new Date(`${input.beginDate}T00:00:00+08:00`),
        )
      : undefined,
    input.endDate
      ? lt(
          notifications.occurredAt,
          new Date(
            new Date(`${input.endDate}T00:00:00+08:00`).getTime() + 86_400_000,
          ),
        )
      : undefined,
  );

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
  listRules(organizationId: string, userId: string) {
    return withTenantDbContext(
      { organizationId, userId },
      (tx) =>
        tx
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
          .orderBy(
            desc(notificationRules.updatedAt),
            desc(notificationRules.id),
          ),
      { accessMode: "read only" },
    );
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
  // @project-doc docs/domains/geo_operations.md#notification_workflow
  async createRule(
    input: NotificationRuleInput,
    userId: string,
    commit: CommitRule,
  ) {
    return withTenantDbContext(
      { organizationId: input.organizationId, userId },
      async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${`${input.type}:${scopeKey(input)}`}))`,
        );
        const [current] = await tx
          .select()
          .from(notificationRules)
          .where(
            and(
              eq(notificationRules.organizationId, input.organizationId),
              eq(notificationRules.type, input.type),
              eq(notificationRules.scopeKey, scopeKey(input)),
            ),
          )
          .limit(1);
        if (current)
          return sameNotificationRule(current, input) &&
            current.updatedBy === userId
            ? { ok: true as const, rule: current, replayed: true }
            : {
                ok: false as const,
                code: "NOTIFICATION_RULE_EXISTS" as const,
                current,
              };
        const [rule] = await tx
          .insert(notificationRules)
          .values(ruleValues(input, userId))
          .returning();
        await commit(tx, rule);
        return { ok: true as const, rule, replayed: false };
      },
    );
  },
  async replaceRule(
    id: string,
    input: NotificationRuleReplaceInput,
    userId: string,
    commit: CommitRule,
  ) {
    return withTenantDbContext(
      { organizationId: input.organizationId, userId },
      async (tx) => {
        const [current] = await tx
          .select()
          .from(notificationRules)
          .where(
            and(
              eq(notificationRules.id, id),
              eq(notificationRules.organizationId, input.organizationId),
            ),
          )
          .for("update")
          .limit(1);
        if (!current)
          return {
            ok: false as const,
            code: "NOTIFICATION_RULE_NOT_FOUND" as const,
          };
        if (sameNotificationRule(current, input))
          return { ok: true as const, rule: current, replayed: true };
        if (!sameNotificationRule(current, input.expected))
          return {
            ok: false as const,
            code: "NOTIFICATION_RULE_CONFLICT" as const,
            current,
          };
        const [rule] = await tx
          .update(notificationRules)
          .set(ruleValues(input, userId))
          .where(eq(notificationRules.id, id))
          .returning();
        await commit(tx, rule);
        return { ok: true as const, rule, replayed: false };
      },
    );
  },
  async disableRule(
    id: string,
    organizationId: string,
    userId: string,
    commit: CommitRule,
  ) {
    return withTenantDbContext({ organizationId, userId }, async (tx) => {
      const [current] = await tx
        .select()
        .from(notificationRules)
        .where(
          and(
            eq(notificationRules.id, id),
            eq(notificationRules.organizationId, organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current || !current.enabled) return current;
      const [rule] = await tx
        .update(notificationRules)
        .set({ enabled: false, updatedBy: userId, updatedAt: new Date() })
        .where(eq(notificationRules.id, id))
        .returning();
      await commit(tx, rule);
      return rule;
    });
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
    input: NotificationListQuery,
    unrestricted: boolean,
  ) {
    return withTenantDbContext(
      { organizationId, userId },
      async (tx) => {
        const readJoin = and(
          eq(notificationReads.notificationId, notifications.id),
          eq(notificationReads.userId, userId),
        );
        const allowed = visibleNotices(organizationId, userId, unrestricted);
        const where = and(
          allowed,
          noticeFilters(input),
          input.unreadOnly ? isNull(notificationReads.readAt) : undefined,
        );
        const [total] = await tx
          .select({ value: count(notifications.id) })
          .from(notifications)
          .leftJoin(notificationReads, readJoin)
          .where(where);
        const [unread] = await tx
          .select({ value: count(notifications.id) })
          .from(notifications)
          .leftJoin(notificationReads, readJoin)
          .where(and(allowed, isNull(notificationReads.readAt)));
        const page = Math.min(
          input.page,
          Math.max(1, Math.ceil(total.value / input.pageSize)),
        );
        const list = await tx
          .select(projection)
          .from(notifications)
          .leftJoin(notificationReads, readJoin)
          .where(where)
          .orderBy(desc(notifications.occurredAt), desc(notifications.id))
          .limit(input.pageSize)
          .offset((page - 1) * input.pageSize);
        return {
          list,
          total: total.value,
          unreadCount: unread.value,
          page,
          pageSize: input.pageSize,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  },
  async readAll(
    input: NotificationReadAllInput,
    userId: string,
    unrestricted: boolean,
  ) {
    return withTenantDbContext(
      { organizationId: input.organizationId, userId },
      async (tx) => {
        const result = await tx.execute<{ count: number }>(sql`
        with inserted as (
          insert into notification_reads (notification_id, user_id)
          select ${notifications.id}, ${userId}::uuid from ${notifications}
          where ${and(visibleNotices(input.organizationId, userId, unrestricted), noticeFilters(input))}
          on conflict (notification_id, user_id) do nothing returning 1
        ) select count(*)::int as count from inserted
      `);
        return { count: result.rows[0]?.count ?? 0 };
      },
    );
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
  async setRead(
    notificationId: string,
    organizationId: string,
    userId: string,
    read: boolean,
  ) {
    return withTenantDbContext({ organizationId, userId }, async (tx) => {
      if (!read) {
        await tx
          .delete(notificationReads)
          .where(
            and(
              eq(notificationReads.notificationId, notificationId),
              eq(notificationReads.userId, userId),
            ),
          );
        return null;
      }
      const [receipt] = await tx
        .insert(notificationReads)
        .values({ notificationId, userId })
        .onConflictDoUpdate({
          target: [notificationReads.notificationId, notificationReads.userId],
          set: { readAt: new Date() },
        })
        .returning();
      return receipt;
    });
  },
};
