import {
  answerbitApiCalls,
  answerbitBrandMappings,
  articleGenerationJobs,
  balanceTransactions,
  brandAccess,
  db,
  memberRoles,
  operationLogs,
  organizationMembers,
  organizationUserFeatureScopes,
  organizations,
  notificationRules,
  platformUserRoles,
  roles,
  reportExports,
  runtimeHeartbeats,
  runtimeTaskStatuses,
  sessions,
  users,
} from "@geo/db";
import { and, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import {
  classifyRuntimeTaskHealth,
  runtimeTaskDefinitions,
  type OrganizationFeature,
  type RuntimeTaskName,
} from "@geo/core";
import {
  lockMemberAccount,
  lockUserOrganizations,
  assertAccountAdministratorHandover,
} from "./member-lifecycle";

type Page = { page: number; pageSize: number; q?: string; status?: string };
type UserPage = Page & {
  accountType?: "admin" | "agent" | "customer";
};
type UserUpdate = {
  name?: string;
  status?: "active" | "disabled";
  accountType?: "agent" | "customer";
  pricingTier?: "retail" | "bronze" | "silver" | "gold";
  agentValidFrom?: Date | null;
  agentExpiresAt?: Date | null;
  agentEnterpriseLimit?: number | null;
  agentBrandLimit?: number | null;
  agentAnswerbitPointsLimit?: number | null;
};
type UserFeatureScope = {
  organizationId: string;
  features: OrganizationFeature[];
};
const pageMeta = (input: Page, total: number) => ({
  page: input.page,
  pageSize: input.pageSize,
  total,
  pages: Math.ceil(total / input.pageSize),
});
const search = (q?: string) =>
  q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : undefined;

export const adminRepository = {
  async overview() {
    const [
      [tenant],
      [user],
      [member],
      [answerbitHealth],
      [workerHealth],
      [notificationHealth],
      [articleJobHealth],
      [reportJobHealth],
      runtimeTaskRows,
    ] = await Promise.all([
      db
        .select({
          value: sql<number>`count(distinct ${answerbitBrandMappings.organizationId})::int`,
        })
        .from(answerbitBrandMappings)
        .innerJoin(
          organizations,
          eq(organizations.id, answerbitBrandMappings.organizationId),
        )
        .where(ne(organizations.status, "closed")),
      db
        .select({
          value: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${users.status} = 'active' and (${users.accountType} <> 'agent' or ((${users.agentValidFrom} is null or ${users.agentValidFrom} <= now()) and (${users.agentExpiresAt} is null or ${users.agentExpiresAt} > now()))))::int`,
          disabled: sql<number>`count(*) filter (where ${users.status} = 'disabled')::int`,
          scheduledAgents: sql<number>`count(*) filter (where ${users.status} = 'active' and ${users.accountType} = 'agent' and ${users.agentValidFrom} > now())::int`,
          expiredAgents: sql<number>`count(*) filter (where ${users.status} = 'active' and ${users.accountType} = 'agent' and ${users.agentExpiresAt} <= now())::int`,
          admins: sql<number>`count(*) filter (where ${users.accountType} = 'admin')::int`,
          agents: sql<number>`count(*) filter (where ${users.accountType} = 'agent')::int`,
          customers: sql<number>`count(*) filter (where ${users.accountType} = 'customer')::int`,
        })
        .from(users),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .innerJoin(
          answerbitBrandMappings,
          eq(
            answerbitBrandMappings.organizationId,
            organizationMembers.organizationId,
          ),
        )
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMembers.organizationId),
        )
        .where(
          and(
            eq(organizationMembers.status, "active"),
            ne(organizations.status, "closed"),
          ),
        ),
      db
        .select({
          total24h: sql<number>`count(*) filter (where ${answerbitApiCalls.createdAt} >= now() - interval '24 hours')::int`,
          failed24h: sql<number>`count(*) filter (where ${answerbitApiCalls.createdAt} >= now() - interval '24 hours' and ${answerbitApiCalls.status} <> 'success')::int`,
          p95DurationMs24h: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${answerbitApiCalls.durationMs}) filter (where ${answerbitApiCalls.createdAt} >= now() - interval '24 hours'), 0)::int`,
        })
        .from(answerbitApiCalls)
        .limit(1),
      db
        .select({
          liveInstances: sql<number>`count(*) filter (where ${runtimeHeartbeats.lastSeenAt} >= now() - interval '90 seconds')::int`,
          lastSeenAt: sql<Date | null>`max(${runtimeHeartbeats.lastSeenAt})`,
        })
        .from(runtimeHeartbeats)
        .where(eq(runtimeHeartbeats.component, "worker"))
        .limit(1),
      db
        .select({
          enabled: sql<number>`count(*) filter (where ${notificationRules.enabled})::int`,
          failed: sql<number>`count(*) filter (where ${notificationRules.enabled} and ${notificationRules.lastEvaluationError} is not null)::int`,
          stale: sql<number>`count(*) filter (where ${notificationRules.enabled} and greatest(coalesce(${notificationRules.lastEvaluatedAt}, ${notificationRules.createdAt}), ${notificationRules.updatedAt}) < now() - interval '30 minutes')::int`,
        })
        .from(notificationRules)
        .limit(1),
      db
        .select({
          queued: sql<number>`count(*) filter (where ${articleGenerationJobs.status} = 'queued')::int`,
          running: sql<number>`count(*) filter (where ${articleGenerationJobs.status} = 'running')::int`,
          stale: sql<number>`count(*) filter (where (${articleGenerationJobs.status} = 'queued' and ${articleGenerationJobs.updatedAt} < now() - interval '10 minutes') or (${articleGenerationJobs.status} = 'running' and ${articleGenerationJobs.updatedAt} < now() - interval '15 minutes'))::int`,
          failed24h: sql<number>`count(*) filter (where ${articleGenerationJobs.status} = 'failed' and ${articleGenerationJobs.completedAt} >= now() - interval '24 hours')::int`,
        })
        .from(articleGenerationJobs)
        .limit(1),
      db
        .select({
          queued: sql<number>`count(*) filter (where ${reportExports.status} = 'queued')::int`,
          running: sql<number>`count(*) filter (where ${reportExports.status} = 'running')::int`,
          stale: sql<number>`count(*) filter (where (${reportExports.status} = 'queued' and ${reportExports.updatedAt} < now() - interval '10 minutes') or (${reportExports.status} = 'running' and ${reportExports.updatedAt} < now() - interval '15 minutes'))::int`,
          failed24h: sql<number>`count(*) filter (where ${reportExports.status} = 'failed' and ${reportExports.completedAt} >= now() - interval '24 hours')::int`,
        })
        .from(reportExports)
        .limit(1),
      db.select().from(runtimeTaskStatuses),
    ]);
    const calls24h = answerbitHealth?.total24h ?? 0;
    const failedCalls24h = answerbitHealth?.failed24h ?? 0;
    const liveWorkerInstances = workerHealth?.liveInstances ?? 0;
    const lastWorkerHeartbeatAt = workerHealth?.lastSeenAt ?? null;
    const taskRowsByName = new Map(
      runtimeTaskRows.map((row) => [row.taskName, row]),
    );
    const runtimeTasks = (
      Object.keys(runtimeTaskDefinitions) as RuntimeTaskName[]
    ).map((taskName) => {
      const definition = runtimeTaskDefinitions[taskName];
      const row = taskRowsByName.get(taskName);
      return {
        taskName,
        label: definition.label,
        status: classifyRuntimeTaskHealth(row),
        state: row?.state ?? null,
        instanceId: row?.instanceId ?? null,
        lastStartedAt: row?.lastStartedAt ?? null,
        lastSucceededAt: row?.lastSucceededAt ?? null,
        lastFailedAt: row?.lastFailedAt ?? null,
        lastDurationMs: row?.lastDurationMs ?? null,
        lastErrorCode: row?.lastErrorCode ?? null,
        expectedIntervalSeconds:
          row?.expectedIntervalSeconds ?? definition.expectedIntervalSeconds,
        timeoutSeconds: row?.timeoutSeconds ?? definition.timeoutSeconds,
      };
    });
    const healthyRuntimeTasks = runtimeTasks.filter((task) =>
      ["healthy", "running"].includes(task.status),
    ).length;
    return {
      organizations: tenant?.value ?? 0,
      users: user?.value ?? 0,
      activeUsers: user?.active ?? 0,
      disabledUsers: user?.disabled ?? 0,
      scheduledAgents: user?.scheduledAgents ?? 0,
      expiredAgents: user?.expiredAgents ?? 0,
      adminUsers: user?.admins ?? 0,
      agentUsers: user?.agents ?? 0,
      customerUsers: user?.customers ?? 0,
      activeMemberships: member?.value ?? 0,
      answerbitCalls24h: calls24h,
      failedAnswerbitCalls24h: failedCalls24h,
      answerbitFailureRate24h: calls24h
        ? Math.round((failedCalls24h / calls24h) * 1000) / 10
        : 0,
      answerbitP95DurationMs24h: answerbitHealth?.p95DurationMs24h ?? 0,
      workerStatus:
        liveWorkerInstances > 0
          ? ("healthy" as const)
          : lastWorkerHeartbeatAt
            ? ("stale" as const)
            : ("offline" as const),
      liveWorkerInstances,
      lastWorkerHeartbeatAt,
      enabledNotificationRules: notificationHealth?.enabled ?? 0,
      failedNotificationRules: notificationHealth?.failed ?? 0,
      staleNotificationRules: notificationHealth?.stale ?? 0,
      runtimeTasks,
      healthyRuntimeTasks,
      failedRuntimeTasks: runtimeTasks.filter(
        (task) => task.status === "failed",
      ).length,
      staleRuntimeTasks: runtimeTasks.filter((task) => task.status === "stale")
        .length,
      missingRuntimeTasks: runtimeTasks.filter(
        (task) => task.status === "missing",
      ).length,
      queuedArticleJobs: articleJobHealth?.queued ?? 0,
      runningArticleJobs: articleJobHealth?.running ?? 0,
      staleArticleJobs: articleJobHealth?.stale ?? 0,
      failedArticleJobs24h: articleJobHealth?.failed24h ?? 0,
      queuedReportJobs: reportJobHealth?.queued ?? 0,
      runningReportJobs: reportJobHealth?.running ?? 0,
      staleReportJobs: reportJobHealth?.stale ?? 0,
      failedReportJobs24h: reportJobHealth?.failed24h ?? 0,
      staleAsyncJobs:
        (articleJobHealth?.stale ?? 0) + (reportJobHealth?.stale ?? 0),
    };
  },
  async listOrganizations(input: Page) {
    const pattern = search(input.q);
    const where = and(
      input.status
        ? eq(organizations.status, input.status as "active" | "suspended")
        : undefined,
      ne(organizations.status, "closed"),
      pattern
        ? or(
            ilike(organizations.name, pattern),
            ilike(organizations.slug, pattern),
          )
        : undefined,
    );
    const [list, [count]] = await Promise.all([
      db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          serviceExpiresAt: organizations.serviceExpiresAt,
          pointsExpiresAt: organizations.pointsExpiresAt,
          status: organizations.status,
          planCode: organizations.planCode,
          createdAt: organizations.createdAt,
          memberCount: sql<number>`count(distinct ${organizationMembers.id})::int`,
          answerbitBrandId: sql<
            string | null
          >`max(${answerbitBrandMappings.brandId})`,
          answerbitBrandName: sql<
            string | null
          >`max(${answerbitBrandMappings.brandName})`,
        })
        .from(organizations)
        .innerJoin(
          answerbitBrandMappings,
          eq(answerbitBrandMappings.organizationId, organizations.id),
        )
        .leftJoin(
          organizationMembers,
          eq(organizationMembers.organizationId, organizations.id),
        )
        .where(where)
        .groupBy(organizations.id)
        .orderBy(desc(organizations.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(organizations)
        .innerJoin(
          answerbitBrandMappings,
          eq(answerbitBrandMappings.organizationId, organizations.id),
        )
        .where(where),
    ]);
    return { list, pagination: pageMeta(input, count?.value ?? 0) };
  },
  // @project-doc docs/domains/identity_and_access.md#enterprise_validity
  updateOrganization(
    id: string,
    input: {
      status?: "active" | "suspended";
      serviceExpiresAt?: Date;
      pointsExpiresAt?: Date;
      expected?: {
        status?: "active" | "suspended";
        serviceExpiresAt?: Date | null;
        pointsExpiresAt?: Date | null;
      };
    },
    afterUpdate?: (executor: Pick<typeof db, "insert">) => Promise<void>,
  ) {
    return db.transaction(
      async (tx) => {
        const [current] = await tx
          .select()
          .from(organizations)
          .where(
            and(eq(organizations.id, id), ne(organizations.status, "closed")),
          )
          .for("update");
        if (!current) return { status: "not_found" as const };
        const { expected, ...changes } = input;
        if (
          expected &&
          ((expected.status !== undefined &&
            expected.status !== current.status) ||
            (expected.serviceExpiresAt !== undefined &&
              expected.serviceExpiresAt?.getTime() !==
                current.serviceExpiresAt?.getTime()) ||
            (expected.pointsExpiresAt !== undefined &&
              expected.pointsExpiresAt?.getTime() !==
                current.pointsExpiresAt?.getTime()))
        )
          return { status: "conflict" as const, current };
        const serviceExpiry =
          input.serviceExpiresAt ?? current.serviceExpiresAt;
        if (
          input.status === "active" &&
          serviceExpiry &&
          serviceExpiry <= new Date()
        )
          return { status: "service_expired" as const, current };
        const [organization] = await tx
          .update(organizations)
          .set({ ...changes, updatedAt: new Date() })
          .where(eq(organizations.id, id))
          .returning();
        await afterUpdate?.(tx);
        return { status: "updated" as const, organization };
      },
      { isolationLevel: "read committed" },
    );
  },
  async findOrganization(id: string) {
    const [organization] = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        serviceExpiresAt: organizations.serviceExpiresAt,
        pointsExpiresAt: organizations.pointsExpiresAt,
        status: organizations.status,
        planCode: organizations.planCode,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        memberCount: sql<number>`count(distinct ${organizationMembers.id})::int`,
        answerbitBrandId: sql<
          string | null
        >`max(${answerbitBrandMappings.brandId})`,
        answerbitBrandName: sql<
          string | null
        >`max(${answerbitBrandMappings.brandName})`,
      })
      .from(organizations)
      .innerJoin(
        answerbitBrandMappings,
        eq(answerbitBrandMappings.organizationId, organizations.id),
      )
      .leftJoin(
        organizationMembers,
        eq(organizationMembers.organizationId, organizations.id),
      )
      .where(and(eq(organizations.id, id), ne(organizations.status, "closed")))
      .groupBy(organizations.id)
      .limit(1);
    return organization;
  },
  listOrganizationMembers(organizationId: string) {
    return db
      .select({
        id: organizationMembers.id,
        userId: users.id,
        name: users.name,
        username: users.username,
        accountType: users.accountType,
        userStatus: users.status,
        agentValidFrom: users.agentValidFrom,
        agentExpiresAt: users.agentExpiresAt,
        memberStatus: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
        role: roles.code,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .leftJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
      .leftJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(eq(organizationMembers.organizationId, organizationId))
      .orderBy(desc(organizationMembers.createdAt));
  },
  async listUsers(input: UserPage) {
    const pattern = search(input.q);
    const statusCondition =
      input.status === "active"
        ? sql`${users.status} = 'active' and (${users.accountType} <> 'agent' or ((${users.agentValidFrom} is null or ${users.agentValidFrom} <= now()) and (${users.agentExpiresAt} is null or ${users.agentExpiresAt} > now())))`
        : input.status === "scheduled"
          ? sql`${users.status} = 'active' and ${users.accountType} = 'agent' and ${users.agentValidFrom} > now()`
          : input.status === "expired"
            ? sql`${users.status} = 'active' and ${users.accountType} = 'agent' and ${users.agentExpiresAt} <= now()`
            : input.status === "disabled"
              ? eq(users.status, "disabled")
              : undefined;
    const where = and(
      statusCondition,
      input.accountType ? eq(users.accountType, input.accountType) : undefined,
      pattern
        ? or(ilike(users.name, pattern), ilike(users.username, pattern))
        : undefined,
    );
    const [list, [count]] = await Promise.all([
      db
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          accountType: users.accountType,
          pricingTier: users.pricingTier,
          agentValidFrom: users.agentValidFrom,
          agentExpiresAt: users.agentExpiresAt,
          agentEnterpriseLimit: users.agentEnterpriseLimit,
          agentBrandLimit: users.agentBrandLimit,
          agentAnswerbitPointsLimit: users.agentAnswerbitPointsLimit,
          status: users.status,
          createdAt: users.createdAt,
          organizationCount: sql<number>`count(distinct ${organizationMembers.organizationId})::int`,
          brandCount: sql<number>`count(distinct ${brandAccess.brandId})::int`,
          platformRole: sql<string | null>`max(${roles.code})`,
        })
        .from(users)
        .leftJoin(organizationMembers, eq(organizationMembers.userId, users.id))
        .leftJoin(brandAccess, eq(brandAccess.userId, users.id))
        .leftJoin(platformUserRoles, eq(platformUserRoles.userId, users.id))
        .leftJoin(roles, eq(roles.id, platformUserRoles.roleId))
        .where(where)
        .groupBy(users.id)
        .orderBy(desc(users.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(users)
        .where(where),
    ]);
    return { list, pagination: pageMeta(input, count?.value ?? 0) };
  },
  async updateUser(
    id: string,
    input: UserUpdate,
    featureScopes?: UserFeatureScope[],
    updatedBy?: string,
  ) {
    return db.transaction(
      async (tx) => {
        const current = await lockMemberAccount(tx, id);
        if (!current) return undefined;
        const memberships = await lockUserOrganizations(tx, id);
        if (
          featureScopes?.some(
            (scope) =>
              !memberships.some(
                (organization) => organization.id === scope.organizationId,
              ),
          )
        )
          throw new Error("USER_ORGANIZATION_SCOPE_INVALID");
        if (input.accountType && input.accountType !== current.accountType) {
          const tenantRoles =
            input.accountType === "customer"
              ? await tx
                  .select({ id: organizationMembers.id })
                  .from(organizationMembers)
                  .innerJoin(
                    memberRoles,
                    eq(memberRoles.memberId, organizationMembers.id),
                  )
                  .innerJoin(roles, eq(roles.id, memberRoles.roleId))
                  .innerJoin(
                    organizations,
                    eq(organizations.id, organizationMembers.organizationId),
                  )
                  .where(
                    and(
                      eq(organizationMembers.userId, id),
                      eq(roles.code, "tenant_admin"),
                      ne(organizations.status, "closed"),
                    ),
                  )
                  .limit(1)
              : await tx
                  .select({ id: brandAccess.id })
                  .from(brandAccess)
                  .innerJoin(
                    organizations,
                    eq(organizations.id, brandAccess.organizationId),
                  )
                  .where(
                    and(
                      eq(brandAccess.userId, id),
                      ne(organizations.status, "closed"),
                    ),
                  )
                  .limit(1);
          if (tenantRoles.length) throw new Error("ACCOUNT_TYPE_ROLE_CONFLICT");
        }
        const next = {
          ...current,
          ...Object.fromEntries(
            Object.entries(input).filter(([, value]) => value !== undefined),
          ),
        };
        await assertAccountAdministratorHandover(tx, id, current, next);
        const [user] = await tx
          .update(users)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(users.id, id))
          .returning();
        if (user && (input.status === "disabled" || input.accountType))
          await tx.delete(sessions).where(eq(sessions.userId, id));
        if (user && featureScopes) {
          await tx
            .delete(organizationUserFeatureScopes)
            .where(eq(organizationUserFeatureScopes.userId, id));
          if (featureScopes.length)
            await tx.insert(organizationUserFeatureScopes).values(
              featureScopes.map((scope) => ({
                ...scope,
                userId: id,
                updatedBy,
              })),
            );
        }
        return user;
      },
      { isolationLevel: "read committed" },
    );
  },
  async findUser(id: string) {
    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        username: users.username,
        accountType: users.accountType,
        pricingTier: users.pricingTier,
        agentValidFrom: users.agentValidFrom,
        agentExpiresAt: users.agentExpiresAt,
        agentEnterpriseLimit: users.agentEnterpriseLimit,
        agentBrandLimit: users.agentBrandLimit,
        agentAnswerbitPointsLimit: users.agentAnswerbitPointsLimit,
        status: users.status,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        platformRole: sql<string | null>`max(${roles.code})`,
      })
      .from(users)
      .leftJoin(platformUserRoles, eq(platformUserRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, platformUserRoles.roleId))
      .where(eq(users.id, id))
      .groupBy(users.id)
      .limit(1);
    return user;
  },
  async getUserRoleConstraints(userId: string) {
    const [[tenantAdmin], [brandScope]] = await Promise.all([
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(organizationMembers)
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMembers.organizationId),
        )
        .innerJoin(
          memberRoles,
          eq(memberRoles.memberId, organizationMembers.id),
        )
        .innerJoin(roles, eq(roles.id, memberRoles.roleId))
        .where(
          and(
            eq(organizationMembers.userId, userId),
            eq(roles.code, "tenant_admin"),
            ne(organizations.status, "closed"),
          ),
        ),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(brandAccess)
        .innerJoin(
          organizations,
          eq(organizations.id, brandAccess.organizationId),
        )
        .where(
          and(
            eq(brandAccess.userId, userId),
            ne(organizations.status, "closed"),
          ),
        ),
    ]);
    return {
      tenantAdminCount: tenantAdmin?.value ?? 0,
      brandAccessCount: brandScope?.value ?? 0,
    };
  },
  listUserMemberships(userId: string) {
    return db
      .select({
        memberId: organizationMembers.id,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        organizationStatus: organizations.status,
        memberStatus: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
        role: roles.code,
      })
      .from(organizationMembers)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationMembers.organizationId),
      )
      .leftJoin(memberRoles, eq(memberRoles.memberId, organizationMembers.id))
      .leftJoin(roles, eq(roles.id, memberRoles.roleId))
      .where(
        and(
          eq(organizationMembers.userId, userId),
          ne(organizations.status, "closed"),
        ),
      )
      .orderBy(desc(organizationMembers.createdAt));
  },
  listUserBrandAccess(userId: string) {
    return db
      .select({
        id: brandAccess.id,
        organizationId: organizations.id,
        organizationName: organizations.name,
        brandId: brandAccess.brandId,
        role: brandAccess.role,
        createdAt: brandAccess.createdAt,
      })
      .from(brandAccess)
      .innerJoin(
        organizations,
        eq(organizations.id, brandAccess.organizationId),
      )
      .where(
        and(eq(brandAccess.userId, userId), ne(organizations.status, "closed")),
      )
      .orderBy(desc(brandAccess.createdAt));
  },
  listUserFeatureScopes(userId: string) {
    return db
      .select({
        organizationId: organizationUserFeatureScopes.organizationId,
        features: organizationUserFeatureScopes.features,
        updatedAt: organizationUserFeatureScopes.updatedAt,
      })
      .from(organizationUserFeatureScopes)
      .innerJoin(
        organizations,
        eq(organizations.id, organizationUserFeatureScopes.organizationId),
      )
      .where(
        and(
          eq(organizationUserFeatureScopes.userId, userId),
          ne(organizations.status, "closed"),
        ),
      );
  },
  async getAgentQuotaUsage(userId: string) {
    const [[enterprise], [brand], [points]] = await Promise.all([
      db
        .select({
          value: sql<number>`count(distinct ${organizationMembers.organizationId})::int`,
        })
        .from(organizationMembers)
        .innerJoin(
          memberRoles,
          eq(memberRoles.memberId, organizationMembers.id),
        )
        .innerJoin(roles, eq(roles.id, memberRoles.roleId))
        .innerJoin(
          organizations,
          eq(organizations.id, organizationMembers.organizationId),
        )
        .where(
          and(
            eq(organizationMembers.userId, userId),
            eq(organizationMembers.status, "active"),
            eq(roles.code, "tenant_admin"),
            ne(organizations.status, "closed"),
          ),
        ),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(operationLogs)
        .where(
          and(
            eq(operationLogs.actorUserId, userId),
            eq(operationLogs.result, "success"),
            inArray(operationLogs.operation, [
              "answerbit.brand.create",
              "platform.answerbit.brand.create",
            ]),
          ),
        ),
      db
        .select({
          value: sql<number>`coalesce(sum(${balanceTransactions.amount}), 0)::int`,
        })
        .from(balanceTransactions)
        .where(
          and(
            eq(balanceTransactions.actorUserId, userId),
            eq(balanceTransactions.asset, "answerbit_points"),
            eq(balanceTransactions.operation, "allocate"),
          ),
        ),
    ]);
    return {
      enterpriseCount: enterprise?.value ?? 0,
      brandCount: brand?.value ?? 0,
      answerbitPoints: points?.value ?? 0,
    };
  },
  async listAudits(input: Page) {
    const pattern = search(input.q);
    const where = and(
      input.status
        ? eq(operationLogs.result, input.status as "success" | "failed")
        : undefined,
      pattern
        ? or(
            ilike(operationLogs.operation, pattern),
            ilike(operationLogs.resourceType, pattern),
            ilike(operationLogs.requestId, pattern),
          )
        : undefined,
    );
    const [list, [count]] = await Promise.all([
      db
        .select({
          log: operationLogs,
          actorName: users.name,
          organizationName: organizations.name,
        })
        .from(operationLogs)
        .innerJoin(users, eq(users.id, operationLogs.actorUserId))
        .leftJoin(
          organizations,
          eq(organizations.id, operationLogs.organizationId),
        )
        .where(where)
        .orderBy(desc(operationLogs.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(operationLogs)
        .where(where),
    ]);
    return { list, pagination: pageMeta(input, count?.value ?? 0) };
  },
  async listApiCalls(input: Page) {
    const pattern = search(input.q);
    const where = and(
      input.status
        ? eq(
            answerbitApiCalls.status,
            input.status as "success" | "failed" | "timeout",
          )
        : undefined,
      pattern
        ? or(
            ilike(answerbitApiCalls.operation, pattern),
            ilike(answerbitApiCalls.requestId, pattern),
            ilike(answerbitApiCalls.errorCode, pattern),
            ilike(organizations.name, pattern),
            ilike(users.name, pattern),
            ilike(users.username, pattern),
          )
        : undefined,
    );
    const [list, [count]] = await Promise.all([
      db
        .select({
          call: answerbitApiCalls,
          organizationName: organizations.name,
          actorName: users.name,
          actorUsername: users.username,
        })
        .from(answerbitApiCalls)
        .innerJoin(
          organizations,
          eq(organizations.id, answerbitApiCalls.organizationId),
        )
        .leftJoin(users, eq(users.id, answerbitApiCalls.actorUserId))
        .where(where)
        .orderBy(desc(answerbitApiCalls.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(answerbitApiCalls)
        .innerJoin(
          organizations,
          eq(organizations.id, answerbitApiCalls.organizationId),
        )
        .leftJoin(users, eq(users.id, answerbitApiCalls.actorUserId))
        .where(where),
    ]);
    return { list, pagination: pageMeta(input, count?.value ?? 0) };
  },
};
