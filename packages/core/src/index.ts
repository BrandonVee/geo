import { randomUUID } from "node:crypto";
export { stableErrorCode } from "./error-code";
export * from "./publication-actions";
export { publicationBodyHtml } from "./publication-content";
export * from "./user-access";
export {
  decideAsyncJobRecovery,
  type AsyncJobRecoveryAction,
  type QueueJobState,
} from "./async-job-recovery";
export {
  classifyRuntimeTaskHealth,
  runtimeTaskBlockedReason,
  runtimeTaskDefinitions,
  type RuntimeTaskHealth,
  type RuntimeTaskName,
  type RuntimeTaskState,
} from "./runtime-health";
export {
  answerBitAvailableCredits,
  answerBitCreditUtilization,
  answerBitMeteringOperations,
  isAnswerBitMeteringOperation,
} from "./answerbit-metering";
export {
  classifyConnectionFailure,
  classifyMetricAnomaly,
  connectionFailureCriticalThreshold,
  connectionFailureLookbackLimit,
  countConsecutiveFailures,
  notificationMetricPeriod,
  type ConnectionFailureClassification,
  type MetricAnomalyClassification,
  type NotificationMetric,
  type NotificationSeverity,
} from "./notification-evaluation";
export {
  BoundedJsonResponseError,
  DEFAULT_UPSTREAM_JSON_LIMIT_BYTES,
  discardResponseBody,
  readBoundedJsonResponse,
  type BoundedJsonResponseErrorKind,
} from "./bounded-json-response";
export {
  InvalidAnswerBitEnvelopeError,
  parseAnswerBitEnvelope,
  type AnswerBitEnvelope,
} from "./answerbit-envelope";
export { InvalidSecretEnvelopeError, SecretCipher } from "./secret-cipher";
export { isHttpOrigin } from "./http-origin";
export { calculateMarkedUpPoints } from "./pricing-calculation";
export const createRequestId = () => randomUUID();
export const platformAnswerBitCredentialAad = "platform-answerbit";
export const platformFrogCredentialAad = "platform-frog-publication";
export const platformAnswerBitConnectionSentinel = "platform-shared";
export const maskSecret = (value: string) =>
  `${value.slice(0, 4)}${"*".repeat(
    Math.min(Math.max(value.length - 8, 4), 24),
  )}${value.slice(-4)}`;
export const isPlatformTencentReady = (
  configuration: { teamId: string | null; status: string } | null | undefined,
) => Boolean(configuration?.teamId && configuration.status === "active");

export type TencentBrandDirectoryItem = { id: string; name: string };
export const parseTencentBrandDirectory = (
  value: unknown,
): TencentBrandDirectoryItem[] => {
  if (!Array.isArray(value)) throw new Error("INVALID_BRAND_DIRECTORY");
  const brands = value.map((item) => {
    if (!item || typeof item !== "object")
      throw new Error("INVALID_BRAND_DIRECTORY");
    const { id, brand_name: brandName } = item as {
      id?: unknown;
      brand_name?: unknown;
    };
    if (
      (typeof id !== "string" && typeof id !== "number") ||
      !String(id).trim() ||
      typeof brandName !== "string"
    )
      throw new Error("INVALID_BRAND_DIRECTORY");
    return { id: String(id), name: brandName };
  });
  return [...new Map(brands.map((brand) => [brand.id, brand])).values()];
};
export const advanceTencentBrandMissingSync = (currentCount: number) => {
  const missingSyncCount = Math.max(0, Math.trunc(currentCount)) + 1;
  return { missingSyncCount, shouldClose: missingSyncCount >= 2 };
};

/** Operations published by the AnswerBit Apifox project. */
export const answerBitApifoxOperations = [
  "/geo/query/brand",
  "/geo/brand/create",
  "/geo/brand/bundle/create",
  "/geo/brand/update",
  "/geo/brand/update/icon",
  "/geo/competitor/get",
  "/geo/competitor/create",
  "/geo/competitor/update",
  "/geo/competitor/delete",
  "/geo/base/dashboard",
  "/geo/exposure/trends",
  "/geo/exposure/rank",
  "/geo/score/trends",
  "/geo/score/rank",
  "/geo/team/get/filter_platforms",
  "/geo/title/get",
  "/geo/title/create",
  "/geo/title/update",
  "/geo/title/delete",
  "/geo/title/rank",
  "/geo/prompt/get/group",
  "/geo/prompt/create",
  "/geo/prompt/create/batch",
  "/geo/prompt/update",
  "/geo/prompt/relation/update",
  "/geo/prompt/delete",
  "/geo/prompt/delete/batch",
  "/geo/prompt/trends",
  "/geo/article/tag/get",
  "/geo/article/rank",
  "/geo/article/trace/save",
  "/geo/article/query",
  "/geo/article/trace/detail",
  "/geo/article/template/get",
  "/geo/article/create",
  "/geo/article/get",
  "/geo/task/get",
  "/geo/task/detail/get",
  "/geo/domain/rank",
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
/**
 * Tencent upstream operations used by the deployed official Web client but not
 * currently published in the AnswerBit Apifox project.
 */
export const answerBitCompatibilityOperations = [
  "/geo/brand/get",
  "/geo/brand/delete",
  "/geo/billing/quota/purchase",
] as const;
/** AnswerBit operations integrated by the platform, web gateway, and worker. */
export const answerBitOperations = [
  ...answerBitApifoxOperations,
  ...answerBitCompatibilityOperations,
] as const;
export type AnswerBitOperation = (typeof answerBitOperations)[number];
const answerBitOperationSet = new Set<string>(answerBitOperations);
export const isAnswerBitOperation = (
  operation: string,
): operation is AnswerBitOperation => answerBitOperationSet.has(operation);

/** Business features are the billing boundary; upstream API operations are free. */
export const billableFeatures = [
  {
    code: "ai_article_generation",
    name: "AI 文章生成",
    defaultPoints: 10,
  },
  {
    code: "effect_tracking",
    name: "效果追踪链接",
    defaultPoints: 2,
  },
  {
    code: "ai_video_generation",
    name: "AI 视频生成",
    defaultPoints: 0,
  },
  {
    code: "ai_image_generation",
    name: "AI 图文生成",
    defaultPoints: 0,
  },
  {
    code: "answerbit_agent_analysis",
    name: "AnswerBit Agent 专家分析",
    defaultPoints: 0,
  },
  {
    code: "ai_prompt_recommendation",
    name: "AI 用户提问推荐",
    defaultPoints: 0,
  },
  {
    code: "website_optimization",
    name: "AI 官网优化",
    defaultPoints: 0,
  },
  {
    code: "product_recommendation_analysis",
    name: "AI 商品推荐分析",
    defaultPoints: 0,
  },
] as const;
export type BillableFeatureCode = (typeof billableFeatures)[number]["code"];
const billableFeatureCodes = new Set<string>(
  billableFeatures.map((feature) => feature.code),
);
export const isBillableFeature = (
  featureCode: string,
): featureCode is BillableFeatureCode => billableFeatureCodes.has(featureCode);
export const roles = [
  "super_admin",
  "tenant_admin",
  "brand_admin",
  "brand_editor",
  "brand_viewer",
] as const;
export type Role = (typeof roles)[number];

export const permissions = [
  "platform.tenant.read",
  "platform.tenant.manage",
  "platform.user.read",
  "platform.user.manage",
  "platform.audit.read",
  "platform.answerbit.read",
  "platform.balance.manage",
  "platform.publication.manage",
  "tenant.settings.read",
  "tenant.settings.manage",
  "tenant.member.read",
  "tenant.member.manage",
  "tenant.audit.read",
  "answerbit.connection.read",
  "answerbit.connection.manage",
  "answerbit.resource.read",
  "answerbit.resource.execute",
  "balance.read",
  "balance.allocate",
  "publication.read",
  "publication.create",
  "resource.read",
  "resource.create",
  "resource.update",
  "resource.delete",
  "report.export",
  "notification.read",
  "notification.manage",
] as const;
export type Permission = (typeof permissions)[number];
const all = new Set<Permission>(permissions);
export const rolePermissions: Readonly<Record<Role, ReadonlySet<Permission>>> =
  {
    super_admin: all,
    tenant_admin: new Set(
      permissions.filter((permission) => !permission.startsWith("platform.")),
    ),
    brand_admin: new Set([
      "tenant.audit.read",
      "answerbit.resource.read",
      "answerbit.resource.execute",
      "balance.read",
      "publication.read",
      "publication.create",
      "resource.read",
      "resource.create",
      "resource.update",
      "resource.delete",
      "report.export",
      "notification.read",
    ]),
    brand_editor: new Set([
      "answerbit.resource.read",
      "answerbit.resource.execute",
      "balance.read",
      "publication.read",
      "publication.create",
      "resource.read",
      "resource.create",
      "resource.update",
      "notification.read",
    ]),
    brand_viewer: new Set([
      "answerbit.resource.read",
      "balance.read",
      "publication.read",
      "resource.read",
      "notification.read",
    ]),
  };
export const hasPermission = (role: Role, permission: Permission) =>
  rolePermissions[role].has(permission);

// @project-doc docs/domains/identity_and_access.md#feature_scope
/**
 * 可由平台管理员按企业进一步收窄的功能模块。
 *
 * 角色权限仍是能力上限；这里的功能范围只做 allowlist 交集，不会把角色原本
 * 没有的权限授予用户。没有显式范围记录时沿用角色默认能力。
 */
export const organizationFeatures = [
  "geo_insights",
  "content",
  "publication",
  "balance",
  "report",
  "notification",
  "member_management",
  "enterprise_settings",
] as const;
export type OrganizationFeature = (typeof organizationFeatures)[number];

export const organizationFeaturePermissions: Readonly<
  Record<OrganizationFeature, ReadonlySet<Permission>>
> = {
  geo_insights: new Set([
    "answerbit.resource.read",
    "answerbit.resource.execute",
  ]),
  content: new Set([
    "resource.read",
    "resource.create",
    "resource.update",
    "resource.delete",
  ]),
  publication: new Set(["publication.read", "publication.create"]),
  balance: new Set(["balance.read", "balance.allocate"]),
  report: new Set(["report.export"]),
  notification: new Set(["notification.read", "notification.manage"]),
  member_management: new Set([
    "tenant.member.read",
    "tenant.member.manage",
    "tenant.audit.read",
  ]),
  enterprise_settings: new Set([
    "tenant.settings.read",
    "tenant.settings.manage",
    "answerbit.connection.read",
    "answerbit.connection.manage",
  ]),
};

const permissionFeature = new Map<Permission, OrganizationFeature>(
  organizationFeatures.flatMap((feature) =>
    [...organizationFeaturePermissions[feature]].map(
      (permission) => [permission, feature] as const,
    ),
  ),
);

export const organizationFeatureForPermission = (permission: Permission) =>
  permissionFeature.get(permission);

export const featureScopeAllowsPermission = (
  features: readonly OrganizationFeature[],
  permission: Permission,
) => {
  const feature = organizationFeatureForPermission(permission);
  return feature ? features.includes(feature) : true;
};
export const entitlementKeys = [
  "members",
  "brands",
  "article_generations",
  "report_exports",
  "data_retention_days",
] as const;
export type EntitlementKey = (typeof entitlementKeys)[number];
const csvCell = (value: unknown) => {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
export const recordsToCsv = (rows: Record<string, unknown>[]) => {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `\uFEFF${keys.map(csvCell).join(",")}\r\n${rows.map((row) => keys.map((key) => csvCell(row[key])).join(",")).join("\r\n")}\r\n`;
};

export * from "./enterprise-access";
