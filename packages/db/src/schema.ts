import { sql } from "drizzle-orm";
import type { OrganizationFeature, PublicationProviderAction } from "@geo/core";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const accountType = pgEnum("account_type", [
  "admin",
  "agent",
  "customer",
]);
export const pricingTier = pgEnum("pricing_tier", [
  "retail",
  "bronze",
  "silver",
  "gold",
]);
export const organizationStatus = pgEnum("organization_status", [
  "active",
  "suspended",
  "closed",
]);
export const memberStatus = pgEnum("member_status", [
  "invited",
  "active",
  "disabled",
]);
export const brandRole = pgEnum("brand_role", [
  "brand_admin",
  "brand_editor",
  "brand_viewer",
]);
export const connectionStatus = pgEnum("connection_status", [
  "active",
  "invalid",
  "disabled",
]);
export const answerbitCredentialScope = pgEnum("answerbit_credential_scope", [
  "team",
  "brand",
]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export const roleScope = pgEnum("role_scope", ["platform", "organization"]);
export const operationResult = pgEnum("operation_result", [
  "success",
  "failed",
]);
export const apiCallStatus = pgEnum("api_call_status", [
  "success",
  "failed",
  "timeout",
]);
export const runtimeTaskState = pgEnum("runtime_task_state", [
  "running",
  "succeeded",
  "failed",
]);
export const billingCycle = pgEnum("billing_cycle", ["free", "month", "year"]);
export const billingPlanStatus = pgEnum("billing_plan_status", [
  "active",
  "archived",
]);
export const planVersionStatus = pgEnum("plan_version_status", [
  "draft",
  "published",
  "retired",
]);
export const platformSubscriptionStatus = pgEnum(
  "platform_subscription_status",
  ["active", "expired", "cancelled"],
);
export const quotaOperation = pgEnum("quota_operation", [
  "reserve",
  "commit",
  "release",
  "grant",
  "adjust",
  "expire",
]);
export const reportExportStatus = pgEnum("report_export_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "expired",
]);
export const reportExportType = pgEnum("report_export_type", [
  "answers",
  "domain_rank",
  "article_rank",
]);
export const notificationRuleType = pgEnum("notification_rule_type", [
  "low_credits",
  "connection_failure",
  "metric_anomaly",
]);
export const notificationMetric = pgEnum("notification_metric", [
  "exposure",
  "score",
  "avg_rank",
]);
export const notificationSeverity = pgEnum("notification_severity", [
  "info",
  "warning",
  "critical",
]);
export const balanceAsset = pgEnum("balance_asset", [
  "answerbit_points",
  "publication_cny",
]);
export const balanceOperation = pgEnum("balance_operation", [
  "grant",
  "allocate",
  "consume",
  "restore",
  "adjust",
]);
export const publicationChannelStatus = pgEnum("publication_channel_status", [
  "active",
  "inactive",
]);
export const publicationOrderStatus = pgEnum("publication_order_status", [
  "submitted",
  "processing",
  "published",
  "failed",
  "cancelled",
]);
export const contentDocumentStatus = pgEnum("content_document_status", [
  "draft",
  "ready",
  "archived",
]);
export const contentDocumentSource = pgEnum("content_document_source", [
  "manual",
  "imported",
  "ai_generated",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    username: varchar("username", { length: 32 }).unique(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    accountType: accountType("account_type").default("customer").notNull(),
    pricingTier: pricingTier("pricing_tier").default("retail").notNull(),
    agentValidFrom: timestamp("agent_valid_from", { withTimezone: true }),
    agentExpiresAt: timestamp("agent_expires_at", { withTimezone: true }),
    agentEnterpriseLimit: integer("agent_enterprise_limit"),
    agentBrandLimit: integer("agent_brand_limit"),
    agentAnswerbitPointsLimit: integer("agent_answerbit_points_limit"),
    status: userStatus("status").default("active").notNull(),
    ...timestamps,
  },
  (t) => [
    check(
      "users_agent_validity_type_ck",
      sql`${t.accountType} = 'agent' OR (${t.agentValidFrom} IS NULL AND ${t.agentExpiresAt} IS NULL)`,
    ),
    check(
      "users_agent_validity_range_ck",
      sql`${t.agentValidFrom} IS NULL OR ${t.agentExpiresAt} IS NULL OR ${t.agentValidFrom} < ${t.agentExpiresAt}`,
    ),
    check(
      "users_agent_limits_type_ck",
      sql`${t.accountType} = 'agent' OR (${t.agentEnterpriseLimit} IS NULL AND ${t.agentBrandLimit} IS NULL AND ${t.agentAnswerbitPointsLimit} IS NULL)`,
    ),
    check(
      "users_agent_limits_nonnegative_ck",
      sql`(${t.agentEnterpriseLimit} IS NULL OR ${t.agentEnterpriseLimit} >= 0) AND (${t.agentBrandLimit} IS NULL OR ${t.agentBrandLimit} >= 0) AND (${t.agentAnswerbitPointsLimit} IS NULL OR ${t.agentAnswerbitPointsLimit} >= 0)`,
    ),
    check(
      "users_pricing_tier_type_ck",
      sql`${t.accountType} = 'agent' OR ${t.pricingTier} = 'retail'`,
    ),
  ],
);
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);
export const organizations = pgTable("organizations", {
  serviceExpiresAt: timestamp("service_expires_at", {
    withTimezone: true,
  }).default(sql`now() + interval '1 month'`),
  pointsExpiresAt: timestamp("points_expires_at", {
    withTimezone: true,
  }).default(sql`now() + interval '1 year'`),
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  status: organizationStatus("status").default("active").notNull(),
  planCode: varchar("plan_code", { length: 64 }),
  ...timestamps,
});
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: memberStatus("status").default("invited").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("organization_members_org_user_ux").on(
      t.organizationId,
      t.userId,
    ),
  ],
);
export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 64 }).notNull(),
  scope: roleScope("scope").notNull(),
  createdAt: timestamps.createdAt,
});
export const permissions = pgTable("permissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 128 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamps.createdAt,
});
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("role_permissions_role_permission_ux").on(
      t.roleId,
      t.permissionId,
    ),
  ],
);
export const memberRoles = pgTable(
  "member_roles",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => organizationMembers.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("member_roles_member_role_ux").on(t.memberId, t.roleId)],
);
export const platformUserRoles = pgTable(
  "platform_user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("platform_user_roles_user_role_ux").on(t.userId, t.roleId),
    index("platform_user_roles_user_idx").on(t.userId),
  ],
);
export const organizationUserFeatureScopes = pgTable(
  "organization_user_feature_scopes",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    features: jsonb("features")
      .$type<OrganizationFeature[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("organization_user_feature_scopes_org_user_ux").on(
      t.organizationId,
      t.userId,
    ),
    index("organization_user_feature_scopes_user_idx").on(t.userId),
  ],
);
export const platformAnswerbitCredentials = pgTable(
  "platform_answerbit_credentials",
  {
    id: smallint("id").default(1).primaryKey(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    apiKeyFingerprint: varchar("api_key_fingerprint", {
      length: 128,
    }).notNull(),
    apiKeyHint: varchar("api_key_hint", { length: 32 }).notNull(),
    teamId: varchar("team_id", { length: 128 }),
    permissions: text("permissions")
      .array()
      .default(sql`'{}'::text[]`)
      .notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    status: connectionStatus("status").default("invalid").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    check("platform_answerbit_credentials_singleton_ck", sql`${t.id} = 1`),
  ],
);
export const platformFrogCredentials = pgTable(
  "platform_frog_credentials",
  {
    id: smallint("id").default(1).primaryKey(),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    apiKeyFingerprint: varchar("api_key_fingerprint", {
      length: 128,
    }).notNull(),
    apiKeyHint: varchar("api_key_hint", { length: 32 }).notNull(),
    baseUrl: text("base_url").notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    status: connectionStatus("status").default("invalid").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [check("platform_frog_credentials_singleton_ck", sql`${t.id} = 1`)],
);
export const platformAnswerbitBrands = pgTable(
  "platform_answerbit_brands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    brandName: varchar("brand_name", { length: 255 }).notNull(),
    missingSyncCount: integer("missing_sync_count").default(0).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("platform_answerbit_brands_brand_ux").on(t.brandId),
    check(
      "platform_answerbit_brands_missing_sync_count_ck",
      sql`${t.missingSyncCount} >= 0`,
    ),
  ],
);
export const answerbitReadCache = pgTable(
  "answerbit_read_cache",
  {
    cacheKey: varchar("cache_key", { length: 64 }).primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    brandId: varchar("brand_id", { length: 128 }),
    operation: varchar("operation", { length: 128 }).notNull(),
    response: jsonb("response").notNull(),
    responseHash: varchar("response_hash", { length: 64 }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("answerbit_read_cache_expiry_idx").on(t.expiresAt)],
);
export const answerbitConnections = pgTable(
  "answerbit_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    encryptedApiKey: text("encrypted_api_key").notNull(),
    apiKeyFingerprint: varchar("api_key_fingerprint", {
      length: 128,
    }).notNull(),
    apiKeyHint: varchar("api_key_hint", { length: 32 }).notNull(),
    keyVersion: integer("key_version").default(1).notNull(),
    status: connectionStatus("status").default("active").notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    managedByPlatform: boolean("managed_by_platform").default(false).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answerbit_connections_org_key_ux").on(
      t.organizationId,
      t.apiKeyFingerprint,
    ),
  ],
);
export const answerbitApiCalls = pgTable(
  "answerbit_api_calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => answerbitConnections.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    operation: varchar("operation", { length: 128 }).notNull(),
    answerbitCode: integer("answerbit_code"),
    status: apiCallStatus("status").notNull(),
    httpStatus: integer("http_status"),
    durationMs: integer("duration_ms").notNull(),
    errorCode: varchar("error_code", { length: 128 }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("answerbit_api_calls_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    index("answerbit_api_calls_created_idx").on(t.createdAt),
    index("answerbit_api_calls_request_idx").on(t.requestId),
    index("answerbit_api_calls_actor_created_idx").on(
      t.actorUserId,
      t.createdAt,
    ),
  ],
);
export const answerbitTeamBindings = pgTable(
  "answerbit_team_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => answerbitConnections.id),
    teamId: varchar("team_id", { length: 128 }).notNull(),
    displayName: varchar("display_name", { length: 128 }),
    isDefault: boolean("is_default").default(false).notNull(),
    status: connectionStatus("status").default("active").notNull(),
    brandCount: integer("brand_count").default(0).notNull(),
    lastErrorCode: varchar("last_error_code", { length: 128 }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answerbit_team_bindings_org_team_ux").on(
      t.organizationId,
      t.teamId,
    ),
    uniqueIndex("answerbit_team_bindings_one_default_ux")
      .on(t.organizationId)
      .where(sql`${t.isDefault} = true`),
  ],
);
export const answerbitCredentialAssignments = pgTable(
  "answerbit_credential_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => answerbitConnections.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 128 }),
    scopeType: answerbitCredentialScope("scope_type").notNull(),
    brandId: varchar("brand_id", { length: 128 }),
    permissions: text("permissions").array().notNull(),
    priority: integer("priority").default(100).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answerbit_credential_assignments_team_connection_ux").on(
      t.teamBindingId,
      t.connectionId,
    ),
    index("answerbit_credential_assignments_org_team_idx").on(
      t.organizationId,
      t.teamBindingId,
    ),
    index("answerbit_credential_assignments_team_brand_idx").on(
      t.teamBindingId,
      t.brandId,
    ),
    check(
      "answerbit_credential_assignments_scope_ck",
      sql`(${t.scopeType} = 'team' AND ${t.brandId} IS NULL) OR (${t.scopeType} = 'brand' AND ${t.brandId} IS NOT NULL)`,
    ),
    check(
      "answerbit_credential_assignments_permissions_ck",
      sql`cardinality(${t.permissions}) > 0`,
    ),
    check(
      "answerbit_credential_assignments_priority_ck",
      sql`${t.priority} BETWEEN 1 AND 1000`,
    ),
  ],
);
export const answerbitBrandMappings = pgTable(
  "answerbit_brand_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    brandName: varchar("brand_name", { length: 255 }).notNull(),
    alias: text("alias"),
    website: text("website"),
    description: text("description"),
    note: text("note"),
    websiteAutoTrace: boolean("website_auto_trace"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answerbit_brand_mappings_scope_ux").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
    ),
    uniqueIndex("answerbit_brand_mappings_org_ux").on(t.organizationId),
    uniqueIndex("answerbit_brand_mappings_brand_ux").on(t.brandId),
    index("answerbit_brand_mappings_org_team_idx").on(
      t.organizationId,
      t.teamBindingId,
    ),
  ],
);
export const balanceAccounts = pgTable(
  "balance_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    brandId: varchar("brand_id", { length: 128 }),
    asset: balanceAsset("asset").notNull(),
    balance: integer("balance").default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("balance_accounts_organization_asset_ux")
      .on(t.organizationId, t.asset)
      .where(sql`${t.brandId} is null`),
    uniqueIndex("balance_accounts_brand_asset_ux")
      .on(t.organizationId, t.brandId, t.asset)
      .where(sql`${t.brandId} is not null`),
    index("balance_accounts_org_brand_idx").on(t.organizationId, t.brandId),
    check("balance_accounts_nonnegative_ck", sql`${t.balance} >= 0`),
  ],
);
export const balanceTransactions = pgTable(
  "balance_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    asset: balanceAsset("asset").notNull(),
    operation: balanceOperation("operation").notNull(),
    amount: integer("amount").notNull(),
    sourceAccountId: uuid("source_account_id").references(
      () => balanceAccounts.id,
    ),
    targetAccountId: uuid("target_account_id").references(
      () => balanceAccounts.id,
    ),
    sourceBalanceAfter: integer("source_balance_after"),
    targetBalanceAfter: integer("target_balance_after"),
    referenceType: varchar("reference_type", { length: 64 }).notNull(),
    referenceId: varchar("reference_id", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("balance_transactions_org_idempotency_ux").on(
      t.organizationId,
      t.idempotencyKey,
    ),
    index("balance_transactions_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    index("balance_transactions_created_idx").on(t.createdAt),
    index("balance_transactions_actor_created_idx").on(
      t.actorUserId,
      t.createdAt,
    ),
    index("balance_transactions_org_actor_created_idx").on(
      t.organizationId,
      t.actorUserId,
      t.createdAt,
    ),
    check("balance_transactions_positive_ck", sql`${t.amount} > 0`),
  ],
);
export const featurePointCosts = pgTable(
  "feature_point_costs",
  {
    featureCode: varchar("feature_code", { length: 128 }).primaryKey(),
    points: integer("points").default(0).notNull(),
    description: text("description").default("").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [check("feature_point_costs_nonnegative_ck", sql`${t.points} >= 0`)],
);
export const pricingTierRules = pgTable(
  "pricing_tier_rules",
  {
    tier: pricingTier("tier").primaryKey(),
    displayName: varchar("display_name", { length: 32 }).notNull(),
    publicationMarkupBps: integer("publication_markup_bps").notNull(),
    pointMarkupBps: integer("point_markup_bps").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    check(
      "pricing_tier_rules_markup_ck",
      sql`${t.publicationMarkupBps} >= 0 AND ${t.publicationMarkupBps} <= 100000`,
    ),
    check(
      "pricing_tier_rules_point_markup_ck",
      sql`${t.pointMarkupBps} >= -10000 AND ${t.pointMarkupBps} <= 100000`,
    ),
  ],
);
export const publicationChannels = pgTable(
  "publication_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    priceAmount: integer("price_amount").notNull(),
    providerCostAmount: integer("provider_cost_amount").default(0).notNull(),
    currency: varchar("currency", { length: 3 }).default("CNY").notNull(),
    status: publicationChannelStatus("status").default("active").notNull(),
    providerStatus: publicationChannelStatus("provider_status")
      .default("active")
      .notNull(),
    provider: varchar("provider", { length: 32 }).default("manual").notNull(),
    providerResourceId: varchar("provider_resource_id", { length: 128 }),
    providerMediaType: varchar("provider_media_type", { length: 32 }),
    remarks: text("remarks").default("").notNull(),
    caseLink: text("case_link"),
    providerMetadata: jsonb("provider_metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    ...timestamps,
  },
  (t) => [
    check(
      "publication_channels_price_ck",
      sql`${t.priceAmount} >= 0 and ${t.providerCostAmount} >= 0 and ${t.currency} = 'CNY'`,
    ),
    uniqueIndex("publication_channels_provider_resource_ux").on(
      t.provider,
      t.providerMediaType,
      t.providerResourceId,
    ),
  ],
);
export const publicationChannelPriceOverrides = pgTable(
  "publication_channel_price_overrides",
  {
    channelId: uuid("channel_id")
      .notNull()
      .references(() => publicationChannels.id, { onDelete: "cascade" }),
    tier: pricingTier("tier").notNull(),
    priceAmount: integer("price_amount").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.tier] }),
    check(
      "publication_channel_price_overrides_price_ck",
      sql`${t.priceAmount} >= 0`,
    ),
    index("publication_channel_price_overrides_tier_idx").on(t.tier),
  ],
);
export const contentFolders = pgTable(
  "content_folders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    creationKey: varchar("creation_key", { length: 128 }),
    creationFingerprint: varchar("creation_fingerprint", { length: 64 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("content_folders_scope_name_ux")
      .on(t.organizationId, t.teamBindingId, t.brandId, t.name)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("content_folders_org_creation_key_ux").on(
      t.organizationId,
      t.creationKey,
    ),
    index("content_folders_scope_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.createdAt,
    ),
  ],
);
export const contentDocuments = pgTable(
  "content_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    folderId: uuid("folder_id").references(() => contentFolders.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    updatedBy: uuid("updated_by")
      .notNull()
      .references(() => users.id),
    source: contentDocumentSource("source").default("manual").notNull(),
    sourceJobId: uuid("source_job_id"),
    sourceUrl: text("source_url"),
    title: varchar("title", { length: 500 }).notNull(),
    body: text("body").default("").notNull(),
    status: contentDocumentStatus("status").default("draft").notNull(),
    language: varchar("language", { length: 16 }).default("zh-CN").notNull(),
    tags: jsonb("tags")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    creationKey: varchar("creation_key", { length: 128 }),
    creationFingerprint: varchar("creation_fingerprint", { length: 64 }),
    currentVersion: integer("current_version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("content_documents_org_creation_key_ux").on(
      t.organizationId,
      t.creationKey,
    ),
    uniqueIndex("content_documents_source_job_ux").on(t.sourceJobId),
    index("content_documents_scope_updated_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.updatedAt,
    ),
    index("content_documents_folder_idx").on(t.folderId, t.updatedAt),
    check(
      "content_documents_current_version_ck",
      sql`${t.currentVersion} >= 1`,
    ),
  ],
);
export const contentDocumentVersions = pgTable(
  "content_document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => contentDocuments.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    version: integer("version").notNull(),
    title: varchar("title", { length: 500 }).notNull(),
    body: text("body").default("").notNull(),
    status: contentDocumentStatus("status").notNull(),
    language: varchar("language", { length: 16 }).notNull(),
    tags: jsonb("tags")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    changeSummary: varchar("change_summary", { length: 500 })
      .default("")
      .notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("content_document_versions_document_version_ux").on(
      t.documentId,
      t.version,
    ),
    index("content_document_versions_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    check("content_document_versions_version_ck", sql`${t.version} >= 1`),
  ],
);
export const publicationOrders = pgTable(
  "publication_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => publicationChannels.id),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    status: publicationOrderStatus("status").default("submitted").notNull(),
    priceAmount: integer("price_amount").notNull(),
    currency: varchar("currency", { length: 3 }).default("CNY").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    contentUrl: text("content_url"),
    sourceJobId: uuid("source_job_id"),
    sourceDocumentId: uuid("source_document_id").references(
      () => contentDocuments.id,
      { onDelete: "set null" },
    ),
    resultUrl: text("result_url"),
    note: text("note").default("").notNull(),
    providerOrderId: varchar("provider_order_id", { length: 128 }),
    providerStatus: integer("provider_status"),
    providerMessage: text("provider_message"),
    providerSyncedAt: timestamp("provider_synced_at", { withTimezone: true }),
    providerAction: jsonb("provider_action").$type<PublicationProviderAction>(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    processedBy: uuid("processed_by").references(() => users.id),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("publication_orders_org_idempotency_ux").on(
      t.organizationId,
      t.idempotencyKey,
    ),
    index("publication_orders_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    index("publication_orders_status_created_idx").on(t.status, t.createdAt),
    check(
      "publication_orders_price_ck",
      sql`${t.priceAmount} >= 0 and ${t.currency} = 'CNY'`,
    ),
  ],
);
// @project-doc docs/domains/balance_and_publication.md#publication_manuscripts
export const publicationOrderContents = pgTable(
  "publication_order_contents",
  {
    orderId: uuid("order_id")
      .primaryKey()
      .references(() => publicationOrders.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    sourceKind: varchar("source_kind", { length: 24 })
      .$type<"inline_html" | "url" | "document" | "generated">()
      .notNull(),
    contentHtml: text("content_html"),
    contentUrl: text("content_url"),
    submissionNote: text("submission_note").notNull(),
    sourceDocumentId: uuid("source_document_id"),
    sourceDocumentVersion: integer("source_document_version"),
    sourceJobId: uuid("source_job_id"),
    creationFingerprint: varchar("creation_fingerprint", {
      length: 64,
    }).notNull(),
    fingerprintVersion: smallint("fingerprint_version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("publication_order_contents_org_idx").on(t.organizationId),
    check(
      "publication_order_contents_fingerprint_ck",
      sql`${t.fingerprintVersion} = 1 and ${t.creationFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "publication_order_contents_body_ck",
      sql`${t.contentHtml} is null or (char_length(btrim(${t.contentHtml})) > 0 and char_length(${t.contentHtml}) <= 500000)`,
    ),
    check(
      "publication_order_contents_url_ck",
      sql`${t.contentUrl} is null or (char_length(${t.contentUrl}) <= 2000 and ${t.contentUrl} ~* '^https?://')`,
    ),
    check(
      "publication_order_contents_note_ck",
      sql`char_length(${t.submissionNote}) <= 2000`,
    ),
    check(
      "publication_order_contents_source_ck",
      sql`
      (${t.sourceKind} = 'url' and ${t.contentHtml} is null and ${t.contentUrl} is not null and ${t.sourceDocumentId} is null and ${t.sourceDocumentVersion} is null and ${t.sourceJobId} is null)
      or (${t.sourceKind} = 'inline_html' and ${t.contentHtml} is not null and ${t.sourceDocumentId} is null and ${t.sourceDocumentVersion} is null and ${t.sourceJobId} is null)
      or (${t.sourceKind} = 'document' and ${t.contentHtml} is not null and ${t.sourceDocumentId} is not null and ${t.sourceDocumentVersion} is not null and ${t.sourceDocumentVersion} > 0 and ${t.sourceJobId} is null)
      or (${t.sourceKind} = 'generated' and ${t.contentHtml} is not null and ${t.sourceJobId} is not null and ${t.sourceDocumentId} is null and ${t.sourceDocumentVersion} is null)
    `,
    ),
  ],
);
export const answerbitCompetitorMappings = pgTable(
  "answerbit_competitor_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    competitorId: varchar("competitor_id", { length: 128 }).notNull(),
    competitorName: varchar("competitor_name", { length: 255 }).notNull(),
    competitorAlias: varchar("competitor_alias", { length: 255 })
      .default("")
      .notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answerbit_competitor_mappings_scope_ux").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.competitorId,
    ),
    index("answerbit_competitor_mappings_brand_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
    ),
  ],
);
export const answerbitTitleMappings = pgTable(
  "answerbit_title_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    titleId: varchar("title_id", { length: 128 }).notNull(),
    titleName: varchar("title_name", { length: 255 }).notNull(),
    titleDescription: text("title_description").default("").notNull(),
    promptCount: integer("prompt_count").default(0).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answerbit_title_mappings_scope_ux").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.titleId,
    ),
    index("answerbit_title_mappings_brand_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
    ),
  ],
);
export const answerbitPromptMappings = pgTable(
  "answerbit_prompt_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    promptId: varchar("prompt_id", { length: 128 }).notNull(),
    titleId: varchar("title_id", { length: 128 }).notNull(),
    query: text("query").notNull(),
    status: integer("status").default(1).notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answerbit_prompt_mappings_scope_ux").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.promptId,
    ),
    index("answerbit_prompt_mappings_title_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.titleId,
    ),
  ],
);
export const answerbitArticleMappings = pgTable(
  "answerbit_article_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    articleId: varchar("article_id", { length: 128 }).notNull(),
    title: text("title").notNull(),
    status: integer("status").notNull(),
    source: integer("source").notNull(),
    templateType: integer("template_type").notNull(),
    referenceCount: integer("reference_count").default(0).notNull(),
    language: varchar("language", { length: 16 }),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("answerbit_article_mappings_scope_ux").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.articleId,
    ),
    index("answerbit_article_mappings_brand_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
    ),
  ],
);
// @project-doc docs/domains/geo_operations.md#article_tracking
export const articleTrackingSubmissions = pgTable(
  "article_tracking_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", {
      length: 64,
    }).notNull(),
    requestPayload: jsonb("request_payload")
      .$type<{ ciphertext: string }>()
      .notNull(),
    status: varchar("status", { length: 16 })
      .$type<"submitting" | "succeeded" | "failed" | "uncertain">()
      .default("submitting")
      .notNull(),
    points: integer("points").notNull(),
    refunded: boolean("refunded").default(false).notNull(),
    articleId: varchar("article_id", { length: 128 }),
    errorCode: varchar("error_code", { length: 64 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("article_tracking_submissions_org_key_ux").on(
      t.organizationId,
      t.idempotencyKey,
    ),
    index("article_tracking_submissions_scope_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.requestedBy,
      t.createdAt,
    ),
    check(
      "article_tracking_submissions_status_ck",
      sql`${t.status} in ('submitting', 'succeeded', 'failed', 'uncertain')`,
    ),
    check("article_tracking_submissions_points_ck", sql`${t.points} >= 0`),
  ],
);
export const brandAccess = pgTable(
  "brand_access",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: brandRole("role").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("brand_access_scope_user_ux").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.userId,
    ),
  ],
);
export const articleGenerationJobs = pgTable(
  "article_generation_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    pricingSnapshot: jsonb("pricing_snapshot").$type<{
      tier: "retail" | "bronze" | "silver" | "gold";
      basePoints: number;
      pointMarkupBps: number;
      points: number;
    }>(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    queueJobId: varchar("queue_job_id", { length: 128 }),
    executionId: uuid("execution_id"),
    quotaReservationKey: varchar("quota_reservation_key", { length: 160 }),
    requestPayload: jsonb("request_payload")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    status: jobStatus("status").default("queued").notNull(),
    createDispatchedAt: timestamp("create_dispatched_at", {
      withTimezone: true,
    }),
    answerbitArticleId: varchar("answerbit_article_id", { length: 128 }),
    articleTitle: text("article_title"),
    articleBody: text("article_body"),
    articleStatus: integer("article_status"),
    templateType: integer("template_type"),
    source: integer("source"),
    language: varchar("language", { length: 16 }),
    tags: jsonb("tags").$type<{ tagId: string; tagName: string }[]>(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    errorCode: varchar("error_code", { length: 128 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    uniqueIndex("article_jobs_org_idempotency_ux").on(
      t.organizationId,
      t.idempotencyKey,
    ),
    index("article_jobs_org_created_idx").on(t.organizationId, t.createdAt),
    index("article_jobs_status_updated_idx").on(t.status, t.updatedAt),
  ],
);

export type PlanEntitlementDefinition = {
  limit: number | null;
  unit: string;
  reset: "billing_period" | "none";
};
export type PlanEntitlements = Record<string, PlanEntitlementDefinition>;
export const billingPlans = pgTable("billing_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").default("").notNull(),
  status: billingPlanStatus("status").default("active").notNull(),
  ...timestamps,
});
export const billingPlanVersions = pgTable(
  "billing_plan_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => billingPlans.id),
    version: integer("version").notNull(),
    billingCycle: billingCycle("billing_cycle").notNull(),
    currency: varchar("currency", { length: 3 }).default("CNY").notNull(),
    priceAmount: integer("price_amount").notNull(),
    entitlements: jsonb("entitlements").$type<PlanEntitlements>().notNull(),
    status: planVersionStatus("status").default("draft").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("billing_plan_versions_plan_version_cycle_ux").on(
      t.planId,
      t.version,
      t.billingCycle,
    ),
    index("billing_plan_versions_status_idx").on(t.status, t.publishedAt),
    check(
      "billing_plan_versions_positive_ck",
      sql`${t.version} > 0 and ${t.priceAmount} >= 0`,
    ),
  ],
);
export const platformSubscriptions = pgTable(
  "platform_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    planVersionId: uuid("plan_version_id")
      .notNull()
      .references(() => billingPlanVersions.id),
    status: platformSubscriptionStatus("status").default("active").notNull(),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
    }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
    }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("platform_subscriptions_one_active_ux")
      .on(t.organizationId)
      .where(sql`${t.status} = 'active'`),
    index("platform_subscriptions_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
  ],
);
export const subscriptionEntitlements = pgTable(
  "subscription_entitlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => platformSubscriptions.id, { onDelete: "cascade" }),
    entitlementKey: varchar("entitlement_key", { length: 128 }).notNull(),
    limitAmount: integer("limit_amount"),
    usedAmount: integer("used_amount").default(0).notNull(),
    reservedAmount: integer("reserved_amount").default(0).notNull(),
    unit: varchar("unit", { length: 32 }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscription_entitlements_subscription_key_ux").on(
      t.subscriptionId,
      t.entitlementKey,
    ),
    index("subscription_entitlements_org_key_idx").on(
      t.organizationId,
      t.entitlementKey,
    ),
    check(
      "subscription_entitlements_amounts_ck",
      sql`(${t.limitAmount} is null or ${t.limitAmount} >= 0) and ${t.usedAmount} >= 0 and ${t.reservedAmount} >= 0`,
    ),
    check(
      "subscription_entitlements_period_ck",
      sql`${t.periodEnd} > ${t.periodStart}`,
    ),
  ],
);
export const quotaLedgers = pgTable(
  "quota_ledgers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => platformSubscriptions.id),
    entitlementId: uuid("entitlement_id")
      .notNull()
      .references(() => subscriptionEntitlements.id),
    entitlementKey: varchar("entitlement_key", { length: 128 }).notNull(),
    operation: quotaOperation("operation").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after"),
    referenceType: varchar("reference_type", { length: 64 }).notNull(),
    referenceId: varchar("reference_id", { length: 128 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    reason: text("reason"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("quota_ledgers_org_idempotency_ux").on(
      t.organizationId,
      t.idempotencyKey,
    ),
    index("quota_ledgers_org_created_idx").on(t.organizationId, t.createdAt),
    index("quota_ledgers_reference_idx").on(t.referenceType, t.referenceId),
  ],
);
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    page: varchar("page", { length: 64 }).notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    creationKey: varchar("creation_key", { length: 200 }),
    creationFingerprint: varchar("creation_fingerprint", { length: 64 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("saved_views_org_user_name_ux")
      .on(t.organizationId, t.userId, t.name)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("saved_views_org_creation_key_ux").on(
      t.organizationId,
      t.userId,
      t.creationKey,
    ),
    uniqueIndex("saved_views_one_default_ux")
      .on(t.organizationId, t.userId, t.page)
      .where(sql`${t.isDefault} = true and ${t.deletedAt} is null`),
    index("saved_views_user_page_idx").on(t.userId, t.page, t.updatedAt),
  ],
);
export const reportExports = pgTable(
  "report_exports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id),
    brandId: varchar("brand_id", { length: 128 }).notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    reportType: reportExportType("report_type").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    quotaReservationKey: varchar("quota_reservation_key", { length: 160 }),
    queueJobId: varchar("queue_job_id", { length: 128 }),
    executionId: uuid("execution_id"),
    status: reportExportStatus("status").default("queued").notNull(),
    filename: varchar("filename", { length: 255 }),
    mimeType: varchar("mime_type", { length: 100 }),
    fileContent: text("file_content"),
    rowCount: integer("row_count"),
    errorCode: varchar("error_code", { length: 128 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("report_exports_org_idempotency_ux").on(
      t.organizationId,
      t.idempotencyKey,
    ),
    index("report_exports_scope_created_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.createdAt,
    ),
    index("report_exports_status_created_idx").on(t.status, t.createdAt),
    index("report_exports_status_updated_idx").on(t.status, t.updatedAt),
  ],
);
export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    teamBindingId: uuid("team_binding_id")
      .notNull()
      .references(() => answerbitTeamBindings.id, { onDelete: "cascade" }),
    brandId: varchar("brand_id", { length: 128 }),
    type: notificationRuleType("type").notNull(),
    metric: notificationMetric("metric"),
    threshold: integer("threshold").notNull(),
    windowDays: integer("window_days"),
    cooldownMinutes: integer("cooldown_minutes").default(1440).notNull(),
    scopeKey: varchar("scope_key", { length: 300 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
    lastEvaluationError: varchar("last_evaluation_error", { length: 128 }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("notification_rules_org_type_scope_ux").on(
      t.organizationId,
      t.type,
      t.scopeKey,
    ),
    index("notification_rules_enabled_idx").on(t.enabled, t.type, t.updatedAt),
    check(
      "notification_rules_threshold_ck",
      sql`(${t.type} = 'low_credits' and ${t.threshold} >= 0 and ${t.brandId} is null and ${t.metric} is null and ${t.windowDays} is null) or (${t.type} = 'connection_failure' and ${t.threshold} between 1 and 20 and ${t.brandId} is null and ${t.metric} is null and ${t.windowDays} is null) or (${t.type} = 'metric_anomaly' and ${t.threshold} between 1 and 100 and ${t.brandId} is not null and ${t.metric} is not null and ${t.windowDays} between 1 and 90)`,
    ),
    check(
      "notification_rules_cooldown_ck",
      sql`${t.cooldownMinutes} between 5 and 10080`,
    ),
  ],
);
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id").references(() => notificationRules.id),
    teamBindingId: uuid("team_binding_id").references(
      () => answerbitTeamBindings.id,
    ),
    brandId: varchar("brand_id", { length: 128 }),
    type: notificationRuleType("type").notNull(),
    severity: notificationSeverity("severity").default("warning").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    eventKey: varchar("event_key", { length: 160 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("notifications_org_event_ux").on(t.organizationId, t.eventKey),
    index("notifications_org_created_idx").on(t.organizationId, t.createdAt),
    index("notifications_scope_created_idx").on(
      t.organizationId,
      t.teamBindingId,
      t.brandId,
      t.createdAt,
    ),
  ],
);
export const notificationReads = pgTable(
  "notification_reads",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("notification_reads_notification_user_ux").on(
      t.notificationId,
      t.userId,
    ),
    index("notification_reads_user_idx").on(t.userId, t.readAt),
  ],
);
export const operationLogs = pgTable(
  "operation_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id),
    operation: varchar("operation", { length: 128 }).notNull(),
    resourceType: varchar("resource_type", { length: 64 }).notNull(),
    resourceId: varchar("resource_id", { length: 128 }),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    result: operationResult("result").notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    summary: text("summary"),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("operation_logs_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);
export const systemReleaseState = pgTable("system_release_state", {
  component: varchar("component", { length: 32 }).primaryKey(),
  version: varchar("version", { length: 128 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const runtimeHeartbeats = pgTable(
  "runtime_heartbeats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    component: varchar("component", { length: 64 }).notNull(),
    instanceId: uuid("instance_id").notNull(),
    version: varchar("version", { length: 128 }).default("unknown").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("runtime_heartbeats_component_instance_ux").on(
      t.component,
      t.instanceId,
    ),
    index("runtime_heartbeats_component_seen_idx").on(
      t.component,
      t.lastSeenAt,
    ),
  ],
);
export const runtimeTaskStatuses = pgTable(
  "runtime_task_statuses",
  {
    taskName: varchar("task_name", { length: 64 }).primaryKey(),
    state: runtimeTaskState("state").default("running").notNull(),
    runId: uuid("run_id").notNull(),
    instanceId: uuid("instance_id").notNull(),
    expectedIntervalSeconds: integer("expected_interval_seconds").notNull(),
    timeoutSeconds: integer("timeout_seconds").notNull(),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    lastDurationMs: integer("last_duration_ms"),
    lastErrorCode: varchar("last_error_code", { length: 128 }),
    ...timestamps,
  },
  (t) => [
    index("runtime_task_statuses_state_updated_idx").on(t.state, t.updatedAt),
    check(
      "runtime_task_statuses_intervals_ck",
      sql`${t.expectedIntervalSeconds} > 0 and ${t.timeoutSeconds} > 0`,
    ),
    check(
      "runtime_task_statuses_duration_ck",
      sql`${t.lastDurationMs} is null or ${t.lastDurationMs} >= 0`,
    ),
  ],
);
