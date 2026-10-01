"use client";

import { billableFeatures, calculateMarkedUpPoints } from "@geo/core";
import {
  ApiOutlined,
  ArrowLeftOutlined,
  AuditOutlined,
  BankOutlined,
  CloudSyncOutlined,
  DashboardOutlined,
  DeleteOutlined,
  DollarOutlined,
  EditOutlined,
  FundOutlined,
  InboxOutlined,
  KeyOutlined,
  MenuOutlined,
  PauseCircleOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Flex,
  Form,
  Grid,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  theme,
  type TableColumnsType,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { EnterpriseValidity } from "./enterprise-validity";
import { AdminDocumentLibrary } from "./admin-document-library";
import { AdminAccountStatusAction } from "./admin-account-status";
import {
  AdminMemberActions,
  useAdminMemberCommand,
} from "./admin-member-command";
import { AdminPublicationOrders } from "./admin-publication-orders";
import { MeteringClient } from "../dashboard/metering/metering-client";
import type { ScopeOrganization } from "../dashboard/use-answerbit-scope";
import { ThemeToggle } from "../theme-toggle";
type Tab =
  | "overview"
  | "organizations"
  | "users"
  | "integration"
  | "library"
  | "metering"
  | "balances"
  | "publications"
  | "publication-channels"
  | "publication-orders"
  | "operations";
type Overview = {
  organizations: number;
  users: number;
  activeUsers: number;
  disabledUsers: number;
  scheduledAgents: number;
  expiredAgents: number;
  adminUsers: number;
  agentUsers: number;
  customerUsers: number;
  activeMemberships: number;
  answerbitCalls24h: number;
  failedAnswerbitCalls24h: number;
  answerbitFailureRate24h: number;
  answerbitP95DurationMs24h: number;
  workerStatus: "healthy" | "stale" | "offline";
  liveWorkerInstances: number;
  lastWorkerHeartbeatAt: string | null;
  enabledNotificationRules: number;
  failedNotificationRules: number;
  staleNotificationRules: number;
  runtimeTasks: RuntimeTask[];
  healthyRuntimeTasks: number;
  failedRuntimeTasks: number;
  staleRuntimeTasks: number;
  missingRuntimeTasks: number;
  queuedArticleJobs: number;
  runningArticleJobs: number;
  staleArticleJobs: number;
  failedArticleJobs24h: number;
  queuedReportJobs: number;
  runningReportJobs: number;
  staleReportJobs: number;
  failedReportJobs24h: number;
  staleAsyncJobs: number;
};
type RuntimeTask = {
  taskName: string;
  label: string;
  status: "healthy" | "running" | "failed" | "stale" | "missing";
  state: "running" | "succeeded" | "failed" | null;
  instanceId: string | null;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastDurationMs: number | null;
  lastErrorCode: string | null;
  expectedIntervalSeconds: number;
  timeoutSeconds: number;
};
const runtimeTaskStatusMeta = {
  healthy: { color: "success", label: "正常" },
  running: { color: "processing", label: "执行中" },
  failed: { color: "error", label: "失败" },
  stale: { color: "warning", label: "超时" },
  missing: { color: "default", label: "未上报" },
} as const;
type Organization = {
  serviceExpiresAt: string | null;
  pointsExpiresAt: string | null;
  id: string;
  name: string;
  slug: string;
  status: string;
  memberCount: number;
  answerbitBrandId: string | null;
  answerbitBrandName: string | null;
  createdAt: string;
};
type User = {
  id: string;
  name: string;
  username: string | null;
  accountType: "admin" | "agent" | "customer";
  pricingTier: PricingTier;
  agentValidFrom: string | null;
  agentExpiresAt: string | null;
  agentEnterpriseLimit: number | null;
  agentBrandLimit: number | null;
  agentAnswerbitPointsLimit: number | null;
  status: string;
  organizationCount: number;
  brandCount: number;
  platformRole?: string | null;
  createdAt: string;
};
type OrganizationMember = {
  id: string;
  userId: string;
  name: string;
  username: string | null;
  accountType: User["accountType"];
  userStatus: string;
  accountState: "active" | "disabled" | "scheduled" | "expired";
  memberStatus: "active" | "disabled" | "invited";
  joinedAt: string | null;
  role: string | null;
};
type OrganizationDetail = {
  organization: Organization & { planCode: string | null; updatedAt: string };
  members: OrganizationMember[];
};
type UserDetail = {
  user: User & { updatedAt: string };
  memberships: Array<{
    memberId: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    organizationStatus: string;
    memberStatus: string;
    joinedAt: string | null;
    role: string | null;
  }>;
  brandAccess: Array<{
    id: string;
    organizationId: string;
    organizationName: string;
    brandId: string;
    role: string;
  }>;
  featureScopes: Array<{
    organizationId: string;
    features: OrganizationFeature[];
    updatedAt: string;
  }>;
  agentQuotaUsage: {
    enterpriseCount: number;
    brandCount: number;
    answerbitPoints: number;
  };
};
type PlatformAnswerBitBrand = {
  id: string;
  brandId: string;
  brandName: string;
  alias: string | null;
  website: string | null;
  description: string | null;
  note: string | null;
  websiteAutoTrace: boolean | null;
  syncedAt: string;
  organizationId: string | null;
  organizationName: string | null;
};
type PlatformAnswerBitConfiguration = {
  configured: boolean;
  status: "active" | "invalid" | "disabled" | "missing";
  teamId: string | null;
  apiKeyHint: string | null;
  keyVersion: number;
  brands: PlatformAnswerBitBrand[];
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  updatedAt: string | null;
  summary: {
    brandCount: number;
    assignedBrandCount: number;
    availableBrandCount: number;
  };
};
type PointCost = {
  featureCode: string;
  points: number;
  description: string;
};
type BalanceAccount = {
  organizationId: string;
  brandId: string | null;
  asset: "answerbit_points" | "publication_cny";
  balance: number;
};
type BalanceTransaction = {
  id: string;
  organizationId: string;
  organizationName: string;
  actorUserId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  asset: BalanceAccount["asset"];
  operation: "grant" | "allocate" | "consume" | "restore" | "adjust";
  amount: number;
  reason: string;
  referenceType: string;
  createdAt: string;
};
type Channel = {
  id: string;
  name: string;
  category: string;
  priceAmount: number;
  providerCostAmount: number;
  status: string;
  providerStatus: string;
  provider: string;
  providerMediaType: "website" | "wemedia" | null;
  providerMetadata: {
    fieldTitles?: Record<string, string[]>;
    publishRate?: string | number;
    publishTimeSeconds?: string | number;
  };
  tierPrices: Record<PricingTier, { priceAmount: number; overridden: boolean }>;
};
type PricingTier = "retail" | "bronze" | "silver" | "gold";
type PricingTierRule = {
  tier: PricingTier;
  displayName: string;
  publicationMarkupBps: number;
  pointMarkupBps: number;
};
type PublicationProviderBalance = {
  configured: boolean;
  available: boolean;
  moneyAmount: number | null;
  powerCount: number | null;
  checkedAt: string | null;
  message: string;
};
type PublicationProviderConfiguration = {
  configured: boolean;
  source: "database" | "environment" | "missing";
  status: "active" | "invalid" | "disabled" | "missing";
  baseUrl: string;
  apiKeyHint: string | null;
  keyVersion: number;
  lastCheckedAt: string | null;
  updatedAt: string | null;
};
type AuditRow = {
  log: {
    id: string;
    operation: string;
    requestId: string;
    resourceType: string;
    result: string;
    summary: string | null;
    createdAt: string;
  };
  actorName: string;
  organizationName: string | null;
};
type CallRow = {
  call: {
    id: string;
    requestId: string;
    operation: string;
    status: string;
    httpStatus: number | null;
    durationMs: number;
    errorCode: string | null;
    createdAt: string;
  };
  organizationName: string;
  actorName: string | null;
  actorUsername: string | null;
};
type PageData<T> = {
  list: T[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
type UserForm = {
  name: string;
  username: string;
  password: string;
  accountType: User["accountType"];
  pricingTier?: PricingTier;
  agentValidityMode: "permanent" | "range";
  agentValidityRange?: [Dayjs, Dayjs];
};
type UserAccessForm = {
  accountType: "agent" | "customer";
  pricingTier: PricingTier;
  agentValidityMode: "permanent" | "range";
  agentValidityRange?: [Dayjs, Dayjs];
  enterpriseLimit?: number | null;
  brandLimit?: number | null;
  answerbitPointsLimit?: number | null;
  organizationFeatureScopes: Array<{
    organizationId: string;
    features: OrganizationFeature[];
  }>;
};
type GrantForm = {
  operation: "grant" | "deduct";
  account: "enterprise" | "brand";
  asset: BalanceAccount["asset"];
  amount: number;
  reason: string;
};
type CostForm = PointCost;
type ChannelForm = { name: string; category: string; price: number };
type PricingTierRuleForm = {
  displayName: string;
  publicationMarkupPercent: number;
  pointMarkupPercent: number;
};
type MemberForm = {
  userId: string;
  role: "tenant_admin" | "brand_admin" | "brand_editor" | "brand_viewer";
};
type UserOrganizationForm = {
  organizationId: string;
  role: MemberForm["role"];
};
type PlatformCredentialForm = {
  teamId: string;
  apiKey: string;
};
type FrogCredentialForm = {
  baseUrl: string;
  apiKey: string;
};
type PlatformBrandForm = {
  brand: string;
  alias?: string;
  website?: string;
  description?: string;
  note?: string;
  initialPrompts?: string;
  competitors?: string;
};
type PlatformBrandUpdateForm = {
  brandName: string;
  brandAlias?: string;
  website?: string;
  description?: string;
  note?: string;
  websiteAutoTrace: boolean;
};
const tabs: [Tab, string, string][] = [
  ["overview", "00", "运营总览"],
  ["integration", "01", "腾讯服务"],
  ["publications", "02", "发布平台"],
  ["organizations", "03", "企业与品牌"],
  ["users", "04", "客户与代理"],
  ["balances", "05", "资产与计费"],
  ["metering", "06", "腾讯用量"],
  ["publication-channels", "07", "发布渠道"],
  ["publication-orders", "08", "发布订单"],
  ["operations", "09", "运行与审计"],
  ["library", "10", "文章库"],
];
const adminNavigationGroups: Array<{ label: string; keys: Tab[] }> = [
  { label: "总览", keys: ["overview"] },
  {
    label: "服务接入",
    keys: ["integration", "publications"],
  },
  {
    label: "客户经营",
    keys: ["organizations", "users", "balances"],
  },
  {
    label: "业务运营",
    keys: ["library", "metering", "publication-channels", "publication-orders"],
  },
  { label: "系统治理", keys: ["operations"] },
];
const adminSectionMeta: Record<
  Tab,
  { eyebrow: string; title: string; description: string }
> = {
  overview: {
    eyebrow: "平台控制 / 运营总览",
    title: "运营总览",
    description: "集中查看平台资源、用户结构、腾讯接入与运行健康。",
  },
  integration: {
    eyebrow: "服务接入 / 腾讯 AnswerBit",
    title: "腾讯服务接入",
    description: "维护统一 TeamID、API Key，并确认腾讯品牌目录同步状态。",
  },
  organizations: {
    eyebrow: "客户经营 / 企业资源",
    title: "企业与品牌",
    description: "管理腾讯品牌对应的平台企业、成员关系与资源状态。",
  },
  library: {
    eyebrow: "业务运营 / 本地内容",
    title: "文章库",
    description: "按企业查看和维护全平台的 AI 生成、手工创作与导入文章。",
  },
  metering: {
    eyebrow: "业务运营 / 腾讯资源",
    title: "腾讯资源与用量",
    description: "查看固定 TeamID 的订阅、积分、周期配额与计量流水。",
  },
  users: {
    eyebrow: "客户经营 / 客户管理",
    title: "客户与代理管理",
    description: "统一管理平台账户、客户等级、利润策略、代理商额度与企业授权。",
  },
  balances: {
    eyebrow: "客户经营 / 资产中心",
    title: "资产与计费",
    description: "处理企业积分与发布余额入账、计费规则及跨企业资产流水。",
  },
  publications: {
    eyebrow: "服务接入 / 内容发布",
    title: "发布平台接入",
    description: "连接媒体发布平台，验证接口，并查看上游账户资源。",
  },
  "publication-channels": {
    eyebrow: "业务运营 / 内容发布",
    title: "发布渠道",
    description: "管理聚合与人工渠道、分类筛选、采购成本、分级售价及上下架。",
  },
  "publication-orders": {
    eyebrow: "业务运营 / 内容发布",
    title: "发布订单",
    description: "跟踪自动与人工投稿订单，处理履约结果、失败退款和交付记录。",
  },
  operations: {
    eyebrow: "系统治理 / 运行与审计",
    title: "运行与审计",
    description: "查看 Worker、持续检测、操作审计与 AnswerBit 调用健康。",
  },
};
const accountTypeMeta = {
  admin: { color: "red", label: "管理员" },
  agent: { color: "blue", label: "代理商" },
  customer: { color: "default", label: "客户" },
} as const;
const pricingTierMeta: Record<
  PricingTier,
  { label: string; color: string; order: number }
> = {
  retail: { label: "普通用户", color: "default", order: 0 },
  bronze: { label: "铜牌代理", color: "orange", order: 1 },
  silver: { label: "银牌代理", color: "blue", order: 2 },
  gold: { label: "金牌代理", color: "gold", order: 3 },
};
const pricingTiers = ["retail", "bronze", "silver", "gold"] as const;
const roleLabels: Record<string, string> = {
  super_admin: "超级管理员",
  tenant_admin: "企业管理员",
  brand_admin: "品牌管理员",
  brand_editor: "品牌编辑",
  brand_viewer: "品牌查看者",
};
type OrganizationFeature =
  | "geo_insights"
  | "content"
  | "publication"
  | "balance"
  | "report"
  | "notification"
  | "member_management"
  | "enterprise_settings";
const organizationFeatureOptions: Array<{
  value: OrganizationFeature;
  label: string;
}> = [
  { value: "geo_insights", label: "GEO 数据与腾讯能力" },
  { value: "content", label: "内容与素材" },
  { value: "publication", label: "内容发布" },
  { value: "balance", label: "余额与积分划拨" },
  { value: "report", label: "报表导出" },
  { value: "notification", label: "通知中心" },
  { value: "member_management", label: "成员与审计" },
  { value: "enterprise_settings", label: "企业设置" },
];
const allOrganizationFeatures = organizationFeatureOptions.map(
  (option) => option.value,
);
const organizationFeatureLabel = new Map(
  organizationFeatureOptions.map((option) => [option.value, option.label]),
);
const isTab = (value: string | null): value is Tab =>
  tabs.some(([key]) => key === value);
type EffectiveUserStatus = "active" | "disabled" | "scheduled" | "expired";
const effectiveUserStatus = (user: User): EffectiveUserStatus => {
  if (user.status === "disabled") return "disabled";
  if (user.accountType !== "agent") return "active";
  const now = Date.now();
  if (user.agentValidFrom && new Date(user.agentValidFrom).getTime() > now)
    return "scheduled";
  if (user.agentExpiresAt && new Date(user.agentExpiresAt).getTime() <= now)
    return "expired";
  return "active";
};
const effectiveStatusMeta = {
  active: { badge: "success", label: "正常" },
  disabled: { badge: "default", label: "已停用" },
  scheduled: { badge: "processing", label: "未生效" },
  expired: { badge: "error", label: "已过期" },
} as const;
const money = (amount: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    amount / 100,
  );
const focusableTableHeaderRow = () => ({ tabIndex: 0 });
const nonEmptyLines = (value?: string) =>
  (value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
const acceptedBrandIconTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
const brandIconAccept =
  "image/jpeg,image/jpg,image/png,image/gif,image/webp,image/svg+xml";
const brandIconMaxBytes = 2 * 1024 * 1024;
const brandIconMimeByExtension = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
]);
const brandIconMimeType = (file: File) => {
  if (acceptedBrandIconTypes.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return brandIconMimeByExtension.get(extension) ?? "";
};
const brandIconValidationError = (file: File) => {
  if (file.size > brandIconMaxBytes) return "图片不能超过 2MB";
  if (!brandIconMimeType(file)) return "仅支持 JPG、PNG、GIF、WebP 或 SVG 图片";
  return "";
};
async function readFileAsBase64(file: File) {
  const result = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Logo 文件读取失败"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
  const data = result.slice(result.indexOf(",") + 1);
  if (!data) throw new Error("Logo 文件内容为空");
  return data;
}
async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = response.status === 204 ? { data: null } : await response.json();
  if (!response.ok) {
    const detail = Array.isArray(body.error?.details)
      ? body.error.details.find((item: unknown): item is { message: string } =>
          Boolean(
            item &&
              typeof item === "object" &&
              "message" in item &&
              typeof item.message === "string",
          ),
        )?.message
      : undefined;
    throw new Error(detail ?? body.error?.message ?? "请求失败");
  }
  return body.data as T;
}
export function AdminClient({
  userId,
  meteringOrganizations,
  userName,
}: {
  userId: string;
  meteringOrganizations: (ScopeOrganization & { brandId: string })[];
  userName: string;
}) {
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  const desktopNavigation = Boolean(screens.lg);
  const compactTable = !screens.lg;
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const section = searchParams.get("section");
  const tab: Tab = isTab(section) ? section : "overview";
  const [userForm] = Form.useForm<UserForm>();
  const [userAccessForm] = Form.useForm<UserAccessForm>();
  const [grantForm] = Form.useForm<GrantForm>();
  const grantOperation = Form.useWatch("operation", grantForm);
  const grantKey = useRef(crypto.randomUUID());
  const [validityOrganization, setValidityOrganization] =
    useState<Organization | null>(null);
  const [costForm] = Form.useForm<CostForm>();
  const [channelForm] = Form.useForm<ChannelForm>();
  const [pricingTierRuleForm] = Form.useForm<PricingTierRuleForm>();
  const [frogCredentialForm] = Form.useForm<FrogCredentialForm>();
  const [memberForm] = Form.useForm<MemberForm>();
  const [userOrganizationForm] = Form.useForm<UserOrganizationForm>();
  const [userOrganizationOptions, setUserOrganizationOptions] = useState<
    Organization[]
  >([]);
  const userOrganizationSearchVersion = useRef(0);
  const [platformCredentialForm] = Form.useForm<PlatformCredentialForm>();
  const [platformBrandForm] = Form.useForm<PlatformBrandForm>();
  const [platformBrandUpdateForm] = Form.useForm<PlatformBrandUpdateForm>();
  const [selectedNewAccountType, setSelectedNewAccountType] =
    useState<User["accountType"]>("customer");
  const [selectedNewAgentValidityMode, setSelectedNewAgentValidityMode] =
    useState<"permanent" | "range">("permanent");
  const [selectedAccessAccountType, setSelectedAccessAccountType] = useState<
    "agent" | "customer"
  >("customer");
  const [selectedAccessValidityMode, setSelectedAccessValidityMode] = useState<
    "permanent" | "range"
  >("permanent");
  const [selectedMemberRole, setSelectedMemberRole] =
    useState<MemberForm["role"]>("tenant_admin");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<User[]>([]);
  const [platformConfiguration, setPlatformConfiguration] =
    useState<PlatformAnswerBitConfiguration | null>(null);
  const [costs, setCosts] = useState<PointCost[]>([]);
  const [balances, setBalances] = useState<BalanceAccount[]>([]);
  const [balanceTransactions, setBalanceTransactions] = useState<
    BalanceTransaction[]
  >([]);
  const [balanceTransactionUserId, setBalanceTransactionUserId] =
    useState<string>();
  const [
    balanceTransactionOrganizationId,
    setBalanceTransactionOrganizationId,
  ] = useState<string>();
  const [balanceTransactionAsset, setBalanceTransactionAsset] = useState<
    "all" | BalanceAccount["asset"]
  >("all");
  const [balanceTransactionOperation, setBalanceTransactionOperation] =
    useState<"all" | BalanceTransaction["operation"]>("all");
  const [balanceTransactionPage, setBalanceTransactionPage] = useState(1);
  const [balanceTransactionPageSize, setBalanceTransactionPageSize] =
    useState(20);
  const [balanceTransactionTotal, setBalanceTransactionTotal] = useState(0);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [pricingTierRules, setPricingTierRules] = useState<PricingTierRule[]>(
    [],
  );
  const [editingPricingTier, setEditingPricingTier] =
    useState<PricingTierRule | null>(null);
  const [channelPage, setChannelPage] = useState(1);
  const [channelPageSize, setChannelPageSize] = useState(20);
  const [channelTotal, setChannelTotal] = useState(0);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelQuery, setChannelQuery] = useState("");
  const [channelProvider, setChannelProvider] = useState<
    "all" | "frog_media" | "manual"
  >("all");
  const [channelMediaType, setChannelMediaType] = useState<
    "all" | "website" | "wemedia" | "manual"
  >("all");
  const [channelStatus, setChannelStatus] = useState<
    "all" | "active" | "inactive"
  >("all");
  const [channelSort, setChannelSort] = useState<
    "recommended" | "priceAsc" | "rateDesc" | "speedAsc"
  >("recommended");
  const [publicationProviderBalance, setPublicationProviderBalance] =
    useState<PublicationProviderBalance | null>(null);
  const [
    publicationProviderConfiguration,
    setPublicationProviderConfiguration,
  ] = useState<PublicationProviderConfiguration | null>(null);
  const [publicationOrderRefresh, setPublicationOrderRefresh] = useState(0);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const [auditTotal, setAuditTotal] = useState(0);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [callPage, setCallPage] = useState(1);
  const [callPageSize, setCallPageSize] = useState(20);
  const [callTotal, setCallTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [userQueryDraft, setUserQueryDraft] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userStatus, setUserStatus] = useState<"all" | EffectiveUserStatus>(
    "all",
  );
  const [userAccountType, setUserAccountType] = useState<
    "all" | User["accountType"]
  >("all");
  const [organizationQueryDraft, setOrganizationQueryDraft] = useState("");
  const [organizationQuery, setOrganizationQuery] = useState("");
  const [organizationStatus, setOrganizationStatus] = useState<
    "all" | "active" | "suspended"
  >("all");
  const [auditQueryDraft, setAuditQueryDraft] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditStatus, setAuditStatus] = useState<"all" | "success" | "failed">(
    "all",
  );
  const [callQueryDraft, setCallQueryDraft] = useState("");
  const [callQuery, setCallQuery] = useState("");
  const [callStatus, setCallStatus] = useState<
    "all" | "success" | "failed" | "timeout"
  >("all");
  const [userCreateOpen, setUserCreateOpen] = useState(false);
  const [platformBrandCreateOpen, setPlatformBrandCreateOpen] = useState(false);
  const [editingPlatformBrand, setEditingPlatformBrand] =
    useState<PlatformAnswerBitBrand | null>(null);
  const [editingPlatformBrandIcon, setEditingPlatformBrandIcon] = useState<{
    brandId: string;
    brandName: string;
  } | null>(null);
  const [platformBrandIcon, setPlatformBrandIcon] = useState<File | null>(null);
  const [platformBrandIconError, setPlatformBrandIconError] = useState("");
  const [userAccessError, setUserAccessError] = useState("");
  const [editingUserAccess, setEditingUserAccess] = useState<UserDetail | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [editingUserName, setEditingUserName] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState("");
  const [organizationDetail, setOrganizationDetail] =
    useState<OrganizationDetail | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState("");
  const [organizationReadError, setOrganizationReadError] = useState("");
  const [userReadError, setUserReadError] = useState("");
  const organizationDetailVersion = useRef(0);
  const userDetailVersion = useRef(0);
  const directoryUserSearchVersion = useRef(0);
  const organizationGrant = useAdminMemberCommand(
    organizationDetail?.organization.id,
    async (command) => {
      memberForm.resetFields();
      memberForm.setFieldValue("role", "tenant_admin");
      setSelectedMemberRole("tenant_admin");
      await Promise.all([
        openOrganization(command.organizationId, true),
        load(),
      ]);
    },
  );
  const userGrant = useAdminMemberCommand(
    userDetail?.user.id,
    async (command) => {
      if (command.kind !== "grant") return;
      userOrganizationForm.resetFields();
      userOrganizationForm.setFieldValue(
        "role",
        userDetail?.user.accountType === "customer"
          ? "brand_editor"
          : "tenant_admin",
      );
      await Promise.all([openUser(command.userId, true), load()]);
    },
  );

  const [grantOrganization, setGrantOrganization] =
    useState<Organization | null>(null);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [channelTierPrices, setChannelTierPrices] = useState<
    Record<PricingTier, number | null>
  >({ retail: null, bronze: null, silver: null, gold: null });
  const loadRunRef = useRef(0);
  const channelLoadRunRef = useRef(0);
  const channelPageRef = useRef(1);
  const channelPageSizeRef = useRef(20);
  const platformReady = platformConfiguration?.status === "active";
  const workerHealthy = overview?.workerStatus === "healthy";
  const runtimeTasks = overview?.runtimeTasks ?? [];
  const notificationHealthy =
    (overview?.failedNotificationRules ?? 0) === 0 &&
    (overview?.staleNotificationRules ?? 0) === 0;
  const runtimeTasksHealthy = Boolean(
    overview &&
      runtimeTasks.length > 0 &&
      overview.healthyRuntimeTasks === runtimeTasks.length,
  );
  const asyncJobsHealthy = (overview?.staleAsyncJobs ?? 0) === 0;
  const runtimeHealthy =
    workerHealthy &&
    notificationHealthy &&
    runtimeTasksHealthy &&
    asyncJobsHealthy;
  const activeSection = adminSectionMeta[tab];
  const adminMenuItems = adminNavigationGroups.map((group) => ({
    key: group.label,
    label: group.label,
    type: "group" as const,
    children: group.keys.map((key) => ({
      key,
      label: tabs.find(([tabKey]) => tabKey === key)?.[2] ?? key,
      disabled: key !== "integration" && !platformReady,
      icon:
        key === "overview" ? (
          <DashboardOutlined />
        ) : key === "organizations" ? (
          <BankOutlined />
        ) : key === "users" ? (
          <UserOutlined />
        ) : key === "integration" ? (
          <ApiOutlined />
        ) : key === "metering" ? (
          <FundOutlined />
        ) : key === "balances" ? (
          <DollarOutlined />
        ) : key === "publications" ? (
          <ApiOutlined />
        ) : key === "publication-channels" ? (
          <RocketOutlined />
        ) : key === "publication-orders" ? (
          <InboxOutlined />
        ) : (
          <AuditOutlined />
        ),
    })),
  }));
  function selectTab(key: string) {
    if (!isTab(key)) return;
    if (key !== "integration" && !platformReady) {
      setMessage("请先完成腾讯 TeamID 与 API Key 接入");
      return;
    }
    setPage(1);
    setPageSize(20);
    setMobileMenuOpen(false);
    if (key === tab) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", key);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }
  function renderPublicationWorkflow() {
    const items: Array<{
      key: Tab;
      title: string;
      description: string;
    }> = [
      {
        key: "publications",
        title: "接入发布平台",
        description: "验证 API 与上游余额",
      },
      {
        key: "publication-channels",
        title: "经营发布渠道",
        description: "同步、定价与上下架",
      },
      {
        key: "users",
        title: "分配客户等级",
        description: "普通、铜、银、金价格",
      },
      {
        key: "publication-orders",
        title: "跟踪发布订单",
        description: "投稿、履约与失败退款",
      },
    ];
    return (
      <Card className="admin-platform-panel" title="发布业务链路">
        <Row gutter={[12, 12]}>
          {items.map((item, index) => (
            <Col key={item.key} lg={6} sm={12} xs={24}>
              <Button
                block
                aria-current={tab === item.key ? "step" : undefined}
                onClick={() => selectTab(item.key)}
                type={tab === item.key ? "primary" : "default"}
                style={{
                  height: "auto",
                  minHeight: 78,
                  padding: 14,
                  whiteSpace: "normal",
                  textAlign: "left",
                }}
              >
                <Flex align="center" gap={12}>
                  <Typography.Text
                    strong
                    style={{ color: "inherit", flexShrink: 0 }}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </Typography.Text>
                  <Space
                    direction="vertical"
                    size={2}
                    align="start"
                    style={{ minWidth: 0 }}
                  >
                    <Typography.Text strong style={{ color: "inherit" }}>
                      {item.title}
                    </Typography.Text>
                    <Typography.Text style={{ color: "inherit", fontSize: 12 }}>
                      {item.description}
                    </Typography.Text>
                  </Space>
                </Flex>
              </Button>
            </Col>
          ))}
        </Row>
        <Typography.Paragraph
          style={{ marginBottom: 0, marginTop: 14 }}
          type="secondary"
        >
          数据流：媒体发布渠道目录同步到本地缓存 → 平台设置售价与可售状态 →
          客户按等级价格下单并扣发布余额 → 聚合渠道自动投稿、人工渠道后台处理 →
          成功保存交付结果，失败或确认取消后原路退回发布余额。
        </Typography.Paragraph>
      </Card>
    );
  }
  const loadPublicationChannels = useCallback(
    async (nextPage: number, nextPageSize: number) => {
      const runId = ++channelLoadRunRef.current;
      const query = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(nextPageSize),
        sort: channelSort,
      });
      if (channelQuery) query.set("q", channelQuery);
      if (channelProvider !== "all") query.set("provider", channelProvider);
      if (channelMediaType !== "all") query.set("mediaType", channelMediaType);
      if (channelStatus !== "all") query.set("status", channelStatus);
      setChannelLoading(true);
      try {
        const result = await api<PageData<Channel>>(
          `/api/v1/admin/publication-channels?${query.toString()}`,
        );
        if (runId === channelLoadRunRef.current) {
          setChannels(result.list);
          setChannelTotal(result.pagination.total);
        }
      } finally {
        if (runId === channelLoadRunRef.current) setChannelLoading(false);
      }
    },
    [
      channelMediaType,
      channelProvider,
      channelQuery,
      channelSort,
      channelStatus,
    ],
  );
  const load = useCallback(async () => {
    const runId = ++loadRunRef.current;
    setMessage("");
    setLoading(true);
    try {
      const configuration = await api<PlatformAnswerBitConfiguration>(
        "/api/v1/admin/answerbit-configuration",
      );
      if (runId !== loadRunRef.current) return;
      setPlatformConfiguration(configuration);
      if (configuration.status !== "active") {
        setOverview(null);
        if (tab !== "integration") {
          router.replace("/admin?section=integration", { scroll: false });
        }
        return;
      }
      const overviewPromise = api<Overview>("/api/v1/admin/overview").then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      if (tab === "overview") {
        const [recentAudits, recentCalls] = await Promise.all([
          api<PageData<AuditRow>>("/api/v1/admin/audit-logs?page=1&pageSize=5"),
          api<PageData<CallRow>>(
            "/api/v1/admin/answerbit-api-calls?page=1&pageSize=5",
          ),
        ]);
        if (runId !== loadRunRef.current) return;
        setAudits(recentAudits.list);
        setAuditTotal(recentAudits.pagination.total);
        setCalls(recentCalls.list);
        setCallTotal(recentCalls.pagination.total);
      }
      if (tab === "organizations") {
        const organizationParams = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (organizationQuery) organizationParams.set("q", organizationQuery);
        if (organizationStatus !== "all")
          organizationParams.set("status", organizationStatus);
        const [result, userDirectory] = await Promise.all([
          api<PageData<Organization>>(
            `/api/v1/admin/organizations?${organizationParams.toString()}`,
          ),
          api<PageData<User>>(
            "/api/v1/admin/users?page=1&pageSize=100&status=active",
          ),
        ]);
        if (runId !== loadRunRef.current) return;
        setOrganizations(result.list);
        setTotal(result.pagination.total);
        setDirectoryUsers(userDirectory.list);
      }
      if (tab === "users") {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (userQuery) params.set("q", userQuery);
        if (userStatus !== "all") params.set("status", userStatus);
        if (userAccountType !== "all")
          params.set("accountType", userAccountType);
        const [result, nextPricingTierRules] = await Promise.all([
          api<PageData<User>>(`/api/v1/admin/users?${params.toString()}`),
          api<PricingTierRule[]>("/api/v1/admin/pricing-tier-rules"),
        ]);
        if (runId !== loadRunRef.current) return;
        setUsers(result.list);
        setTotal(result.pagination.total);
        setPricingTierRules(nextPricingTierRules);
      }
      if (tab === "balances") {
        const transactionQuery = new URLSearchParams({
          page: String(balanceTransactionPage),
          pageSize: String(balanceTransactionPageSize),
        });
        if (balanceTransactionOrganizationId)
          transactionQuery.set(
            "organizationId",
            balanceTransactionOrganizationId,
          );
        if (balanceTransactionUserId)
          transactionQuery.set("userId", balanceTransactionUserId);
        if (balanceTransactionAsset !== "all")
          transactionQuery.set("asset", balanceTransactionAsset);
        if (balanceTransactionOperation !== "all")
          transactionQuery.set("operation", balanceTransactionOperation);
        const [
          nextOrganizations,
          nextUsers,
          nextCosts,
          nextBalances,
          nextTransactions,
        ] = await Promise.all([
          api<PageData<Organization>>(
            "/api/v1/admin/organizations?page=1&pageSize=100",
          ),
          api<PageData<User>>("/api/v1/admin/users?page=1&pageSize=100"),
          api<PointCost[]>("/api/v1/admin/feature-point-costs"),
          api<BalanceAccount[]>("/api/v1/admin/balances"),
          api<PageData<BalanceTransaction>>(
            `/api/v1/admin/balance-transactions?${transactionQuery.toString()}`,
          ),
        ]);
        if (runId !== loadRunRef.current) return;
        setOrganizations(nextOrganizations.list);
        setDirectoryUsers(nextUsers.list);
        setCosts(nextCosts);
        setBalances(nextBalances);
        setBalanceTransactions(nextTransactions.list);
        setBalanceTransactionTotal(nextTransactions.pagination.total);
      }
      if (tab === "publications") {
        const [nextProviderBalance, nextProviderConfiguration] =
          await Promise.all([
            api<PublicationProviderBalance>(
              "/api/v1/admin/publication-provider-balance",
            ),
            api<PublicationProviderConfiguration>(
              "/api/v1/admin/publication-provider-configuration",
            ),
          ]);
        if (runId !== loadRunRef.current) return;
        setPublicationProviderBalance(nextProviderBalance);
        setPublicationProviderConfiguration(nextProviderConfiguration);
      }
      if (tab === "publication-channels")
        await loadPublicationChannels(
          channelPageRef.current,
          channelPageSizeRef.current,
        );
      if (tab === "publication-orders")
        setPublicationOrderRefresh((version) => version + 1);
      if (tab === "operations") {
        const auditParams = new URLSearchParams({
          page: String(auditPage),
          pageSize: String(auditPageSize),
        });
        if (auditQuery) auditParams.set("q", auditQuery);
        if (auditStatus !== "all") auditParams.set("status", auditStatus);
        const callParams = new URLSearchParams({
          page: String(callPage),
          pageSize: String(callPageSize),
        });
        if (callQuery) callParams.set("q", callQuery);
        if (callStatus !== "all") callParams.set("status", callStatus);
        const [nextAudits, nextCalls] = await Promise.all([
          api<PageData<AuditRow>>(
            `/api/v1/admin/audit-logs?${auditParams.toString()}`,
          ),
          api<PageData<CallRow>>(
            `/api/v1/admin/answerbit-api-calls?${callParams.toString()}`,
          ),
        ]);
        if (runId !== loadRunRef.current) return;
        setAudits(nextAudits.list);
        setAuditTotal(nextAudits.pagination.total);
        setCalls(nextCalls.list);
        setCallTotal(nextCalls.pagination.total);
      }
      const overviewResult = await overviewPromise;
      if (!overviewResult.ok) throw overviewResult.error;
      const nextOverview = overviewResult.value;
      if (runId !== loadRunRef.current) return;
      setOverview(nextOverview);
    } catch (error) {
      if (runId !== loadRunRef.current) return;
      setMessage(error instanceof Error ? error.message : "管理数据加载失败");
    } finally {
      if (runId === loadRunRef.current) setLoading(false);
    }
  }, [
    page,
    pageSize,
    auditPage,
    auditPageSize,
    auditQuery,
    auditStatus,
    balanceTransactionAsset,
    balanceTransactionOperation,
    balanceTransactionOrganizationId,
    balanceTransactionPage,
    balanceTransactionPageSize,
    balanceTransactionUserId,
    callPage,
    callPageSize,
    callQuery,
    callStatus,
    organizationQuery,
    organizationStatus,
    loadPublicationChannels,
    router,
    tab,
    userAccountType,
    userQuery,
    userStatus,
  ]);
  const refreshRuntimeHealth = useCallback(async () => {
    try {
      setOverview(await api<Overview>("/api/v1/admin/overview"));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "运行健康状态刷新失败",
      );
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (tab !== "overview" && tab !== "operations") return;
    const refresh = () => {
      if (!document.hidden && navigator.onLine) void refreshRuntimeHealth();
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [refreshRuntimeHealth, tab]);
  useEffect(() => {
    if (tab !== "organizations") return;
    const refresh = () => {
      if (!document.hidden && navigator.onLine) void load();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load, tab]);
  useEffect(() => {
    if (tab !== "integration" || !platformConfiguration) return;
    platformCredentialForm.setFieldsValue({
      teamId: platformConfiguration.teamId ?? undefined,
    });
  }, [platformConfiguration, platformCredentialForm, tab]);
  useEffect(() => {
    if (tab !== "publications" || !publicationProviderConfiguration) return;
    frogCredentialForm.setFieldsValue({
      baseUrl: publicationProviderConfiguration.baseUrl,
      apiKey: "",
    });
  }, [frogCredentialForm, publicationProviderConfiguration, tab]);
  useEffect(() => {
    if (!editingUserAccess) return;
    const hasRange = Boolean(
      editingUserAccess.user.agentValidFrom ||
        editingUserAccess.user.agentExpiresAt,
    );
    setSelectedAccessAccountType(
      editingUserAccess.user.accountType === "agent" ? "agent" : "customer",
    );
    setSelectedAccessValidityMode(hasRange ? "range" : "permanent");
    userAccessForm.setFieldsValue({
      accountType:
        editingUserAccess.user.accountType === "agent" ? "agent" : "customer",
      pricingTier:
        editingUserAccess.user.accountType === "agent"
          ? editingUserAccess.user.pricingTier
          : "retail",
      agentValidityMode: hasRange ? "range" : "permanent",
      agentValidityRange: [
        editingUserAccess.user.agentValidFrom
          ? dayjs(editingUserAccess.user.agentValidFrom)
          : dayjs(),
        editingUserAccess.user.agentExpiresAt
          ? dayjs(editingUserAccess.user.agentExpiresAt)
          : dayjs().add(1, "year"),
      ],
      enterpriseLimit: editingUserAccess.user.agentEnterpriseLimit ?? undefined,
      brandLimit: editingUserAccess.user.agentBrandLimit ?? undefined,
      answerbitPointsLimit:
        editingUserAccess.user.agentAnswerbitPointsLimit ?? undefined,
      organizationFeatureScopes: [
        ...new Map(
          editingUserAccess.memberships.map((membership) => [
            membership.organizationId,
            membership,
          ]),
        ).values(),
      ].map((membership) => {
        const stored = editingUserAccess.featureScopes.find(
          (scope) => scope.organizationId === membership.organizationId,
        );
        return {
          organizationId: membership.organizationId,
          features: stored ? stored.features : [...allOrganizationFeatures],
        };
      }),
    });
  }, [editingUserAccess, userAccessForm]);
  const userDetailId = userDetail?.user.id;
  const userDetailAccountType = userDetail?.user.accountType;
  useEffect(() => {
    if (!userDetailId) return;
    userOrganizationForm.resetFields();
    userOrganizationForm.setFieldValue(
      "role",
      userDetailAccountType === "customer" ? "brand_editor" : "tenant_admin",
    );
  }, [userDetailId, userDetailAccountType, userOrganizationForm]);
  useEffect(() => {
    if (!editingPlatformBrand) return;
    platformBrandUpdateForm.setFieldsValue({
      brandName: editingPlatformBrand.brandName,
      brandAlias: editingPlatformBrand.alias ?? "",
      website: editingPlatformBrand.website ?? "",
      description: editingPlatformBrand.description ?? "",
      note: editingPlatformBrand.note ?? "",
      websiteAutoTrace: editingPlatformBrand.websiteAutoTrace ?? false,
    });
  }, [editingPlatformBrand, platformBrandUpdateForm]);
  useEffect(() => {
    if (!grantOrganization) return;
    grantForm.resetFields();
    grantForm.setFieldsValue({
      asset: "answerbit_points",
      operation: "grant",
      account: "enterprise",
    });
    grantKey.current = crypto.randomUUID();
  }, [grantForm, grantOrganization]);
  async function patch(url: string, body: unknown, key: string) {
    setBusy(key);
    try {
      await api(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setMessage("操作已完成并写入审计");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function createUser(values: UserForm) {
    setBusy("user");
    try {
      await api("/api/v1/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          username: values.username,
          password: values.password,
          accountType: values.accountType,
          pricingTier:
            values.accountType === "agent"
              ? (values.pricingTier ?? "bronze")
              : undefined,
          agentValidFrom:
            values.accountType === "agent" &&
            values.agentValidityMode === "range"
              ? values.agentValidityRange?.[0].toISOString()
              : undefined,
          agentExpiresAt:
            values.accountType === "agent" &&
            values.agentValidityMode === "range"
              ? values.agentValidityRange?.[1].toISOString()
              : undefined,
        }),
      });
      userForm.resetFields();
      setSelectedNewAccountType("customer");
      setSelectedNewAgentValidityMode("permanent");
      setUserCreateOpen(false);
      setMessage("平台账户已创建，可继续配置企业和品牌权限");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function openOrganization(organizationId: string, refresh = false) {
    const version = ++organizationDetailVersion.current;
    setOrganizationReadError("");
    setDetailLoading("organization");
    try {
      const [detail, availableUsers] = await Promise.all([
        api<OrganizationDetail>(
          `/api/v1/admin/organizations/${organizationId}`,
        ),
        directoryUsers.length
          ? Promise.resolve(null)
          : api<PageData<User>>(
              "/api/v1/admin/users?page=1&pageSize=100&status=active",
            ),
      ]);
      if (version !== organizationDetailVersion.current) return;
      if (!refresh) setSelectedMemberRole("tenant_admin");
      setOrganizationDetail(detail);
      if (availableUsers) setDirectoryUsers(availableUsers.list);
    } catch (error) {
      if (version !== organizationDetailVersion.current) return;
      setMessage((error as Error).message);
      if (refresh) {
        setOrganizationReadError((error as Error).message);
        throw error;
      }
    } finally {
      if (version === organizationDetailVersion.current) setDetailLoading("");
    }
  }
  async function searchDirectoryUsers(value: string) {
    const version = ++directoryUserSearchVersion.current;
    try {
      const result = await api<PageData<User>>(
        `/api/v1/admin/users?page=1&pageSize=100&status=active&q=${encodeURIComponent(value)}`,
      );
      if (version === directoryUserSearchVersion.current)
        setDirectoryUsers(result.list);
    } catch (error) {
      if (version === directoryUserSearchVersion.current)
        setMessage((error as Error).message);
    }
  }
  async function openUser(userId: string, refresh = false) {
    const version = ++userDetailVersion.current;
    setUserReadError("");
    setDetailLoading("user");
    try {
      const detail = await api<UserDetail>(`/api/v1/admin/users/${userId}`);
      if (version === userDetailVersion.current) setUserDetail(detail);
    } catch (error) {
      if (version !== userDetailVersion.current) return;
      setMessage((error as Error).message);
      if (refresh) {
        setUserReadError((error as Error).message);
        throw error;
      }
    } finally {
      if (version === userDetailVersion.current) setDetailLoading("");
    }
  }
  async function searchUserOrganizations(query = "") {
    const version = ++userOrganizationSearchVersion.current;
    try {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "100",
        status: "active",
      });
      if (query.trim()) params.set("q", query.trim());
      const result = await api<PageData<Organization>>(
        `/api/v1/admin/organizations?${params}`,
      );
      if (version === userOrganizationSearchVersion.current)
        setUserOrganizationOptions(result.list);
    } catch (error) {
      if (version === userOrganizationSearchVersion.current)
        setMessage((error as Error).message);
    }
  }
  async function saveUserOrganization(values: UserOrganizationForm) {
    if (!userDetail) return;
    await userGrant.run({
      kind: "grant",
      organizationId: values.organizationId,
      userId: userDetail.user.id,
      role: values.role,
    });
  }
  async function saveUserName() {
    if (
      !editingUserName ||
      !editingUserName.name.trim() ||
      busy === "user-name"
    )
      return;
    const { id, name } = editingUserName;
    setBusy("user-name");
    try {
      await api(`/api/v1/admin/users/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      setEditingUserName(null);
      setMessage("用户名称已更新");
      await Promise.all([load(), openUser(id)]);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  function openUserAccessEditor(detail: UserDetail) {
    setUserAccessError("");
    setEditingUserAccess(detail);
  }
  async function saveUserAccess(values: UserAccessForm) {
    if (!editingUserAccess) return;
    const userId = editingUserAccess.user.id;
    setBusy("user-access");
    setUserAccessError("");
    try {
      await api(`/api/v1/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountType: values.accountType,
          pricingTier:
            values.accountType === "agent" ? values.pricingTier : "retail",
          agentValidFrom:
            values.accountType === "agent" &&
            values.agentValidityMode === "range"
              ? values.agentValidityRange?.[0].toISOString()
              : null,
          agentExpiresAt:
            values.accountType === "agent" &&
            values.agentValidityMode === "range"
              ? values.agentValidityRange?.[1].toISOString()
              : null,
          agentQuota:
            values.accountType === "agent"
              ? {
                  enterpriseLimit: values.enterpriseLimit ?? null,
                  brandLimit: values.brandLimit ?? null,
                  answerbitPointsLimit: values.answerbitPointsLimit ?? null,
                }
              : undefined,
          organizationFeatureScopes: values.organizationFeatureScopes ?? [],
        }),
      });
      setEditingUserAccess(null);
      userAccessForm.resetFields();
      setSelectedAccessAccountType("customer");
      setSelectedAccessValidityMode("permanent");
      setMessage("账户、代理商额度与企业功能范围已更新，新的访问规则即时生效");
      await Promise.all([load(), openUser(userId)]);
    } catch (error) {
      setUserAccessError((error as Error).message);
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function addOrganizationMember(values: MemberForm) {
    if (!organizationDetail) return;
    await organizationGrant.run({
      kind: "grant",
      organizationId: organizationDetail.organization.id,
      userId: values.userId,
      role: values.role,
    });
  }
  async function savePlatformAnswerBitConfiguration(
    values: PlatformCredentialForm,
  ) {
    setBusy("platform-answerbit-save");
    try {
      const configuration = await api<PlatformAnswerBitConfiguration>(
        "/api/v1/admin/answerbit-configuration",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      setPlatformConfiguration(configuration);
      platformCredentialForm.setFieldsValue({
        teamId: configuration.teamId ?? undefined,
        apiKey: undefined,
      });
      await load();
      setMessage("腾讯接入已完成，企业、用户及业务管理模块现已开放");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function createPlatformAnswerbitBrand(values: PlatformBrandForm) {
    setBusy("platform-answerbit-brand-create");
    try {
      const { initialPrompts, competitors, ...brandFields } = values;
      const brand = await api<PlatformAnswerBitBrand>(
        "/api/v1/admin/answerbit-brands",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...brandFields,
            initialPrompts: nonEmptyLines(initialPrompts),
            competitors: nonEmptyLines(competitors).map((name) => ({ name })),
          }),
        },
      );
      setPlatformBrandCreateOpen(false);
      platformBrandForm.resetFields();
      await load();
      setMessage(
        `腾讯企业 ${brand.brandName}（${brand.brandId}）已通过官方接口创建并接入平台`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function openPlatformBrandEditor(brandId: string) {
    setBusy(`platform-answerbit-brand-read-${brandId}`);
    try {
      const brand = await api<PlatformAnswerBitBrand>(
        `/api/v1/admin/answerbit-brands/${encodeURIComponent(brandId)}`,
      );
      setEditingPlatformBrand(brand);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function updatePlatformAnswerbitBrand(values: PlatformBrandUpdateForm) {
    if (!editingPlatformBrand) return;
    const brandId = editingPlatformBrand.brandId;
    setBusy(`platform-answerbit-brand-update-${brandId}`);
    try {
      const brand = await api<PlatformAnswerBitBrand>(
        `/api/v1/admin/answerbit-brands/${encodeURIComponent(brandId)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(values),
        },
      );
      setEditingPlatformBrand(null);
      platformBrandUpdateForm.resetFields();
      await load();
      setMessage(
        `腾讯企业 ${brand.brandName}（${brand.brandId}）已通过官方接口修改`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function updatePlatformAnswerbitBrandIcon() {
    if (!editingPlatformBrandIcon || !platformBrandIcon) return;
    const { brandId, brandName } = editingPlatformBrandIcon;
    const key = `platform-answerbit-brand-icon-${brandId}`;
    setPlatformBrandIconError("");
    setBusy(key);
    try {
      const validationError = brandIconValidationError(platformBrandIcon);
      if (validationError) throw new Error(validationError);
      const result = await api<{ brandId: string; iconUrl: string }>(
        `/api/v1/admin/answerbit-brands/${encodeURIComponent(brandId)}/icon`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            iconMimeType: brandIconMimeType(platformBrandIcon),
            iconData: await readFileAsBase64(platformBrandIcon),
          }),
        },
      );
      setEditingPlatformBrandIcon(null);
      setPlatformBrandIcon(null);
      setPlatformBrandIconError("");
      setMessage(
        `腾讯企业 ${brandName}（${result.brandId}）Logo 已通过官方接口更新`,
      );
    } catch (error) {
      setPlatformBrandIconError((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function deletePlatformAnswerbitBrand(
    brand: Pick<PlatformAnswerBitBrand, "brandId" | "brandName">,
  ) {
    setBusy(`platform-answerbit-brand-delete-${brand.brandId}`);
    try {
      await api(
        `/api/v1/admin/answerbit-brands/${encodeURIComponent(brand.brandId)}`,
        { method: "DELETE" },
      );
      if (organizationDetail?.organization.answerbitBrandId === brand.brandId)
        setOrganizationDetail(null);
      await load();
      setMessage(
        `腾讯企业 ${brand.brandName}（${brand.brandId}）已从腾讯删除，平台投影已关闭`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function grant(values: GrantForm) {
    if (!grantOrganization || busy === `grant-${grantOrganization.id}`) return;
    const { asset, amount: quantity, reason } = values;
    const organizationId = grantOrganization.id;
    setBusy(`grant-${organizationId}`);
    try {
      await api(
        values.operation === "deduct"
          ? "/api/v1/admin/balance-deductions"
          : "/api/v1/admin/balance-grants",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organizationId,
            brandId:
              values.operation === "deduct" && values.account === "brand"
                ? grantOrganization.answerbitBrandId
                : undefined,
            asset,
            amount:
              asset === "publication_cny"
                ? Math.round(quantity * 100)
                : quantity,
            reason,
            idempotencyKey: grantKey.current,
          }),
        },
      );
      grantForm.resetFields();
      setGrantOrganization(null);
      setMessage(
        values.operation === "deduct"
          ? "扣减成功，已记录资产流水与审计"
          : "余额已由平台管理员入账",
      );
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function saveCost(values: CostForm) {
    setBusy("cost");
    try {
      await api("/api/v1/admin/feature-point-costs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          featureCode: values.featureCode,
          points: values.points,
          description: values.description,
        }),
      });
      costForm.resetFields();
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function saveFrogConfiguration(values: FrogCredentialForm) {
    setBusy("frog-configuration");
    try {
      const saved = await api<
        PublicationProviderConfiguration & {
          verification: {
            websiteSampleCount: number;
            websiteFieldCount: number;
            wemediaSampleCount: number;
            wemediaFieldCount: number;
          };
        }
      >("/api/v1/admin/publication-provider-configuration", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      frogCredentialForm.setFieldValue("apiKey", "");
      setPublicationProviderConfiguration(saved);
      try {
        setPublicationProviderBalance(
          await api<PublicationProviderBalance>(
            "/api/v1/admin/publication-provider-balance",
          ),
        );
      } catch {
        // 配置已经保存成功；余额卡片保留现状，后续刷新时会再次读取。
      }
      setMessage(
        `媒体发布 API Key 已加密保存；安全读取能力已验证（分类 ${saved.verification.websiteFieldCount + saved.verification.wemediaFieldCount} 项）。完整渠道正在后台同步，页面可以继续操作。`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function createChannel(values: ChannelForm) {
    setBusy("channel");
    try {
      await api("/api/v1/admin/publication-channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          category: values.category,
          priceAmount: Math.round(values.price * 100),
        }),
      });
      channelForm.resetFields();
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  function openChannelPrice(channel: Channel) {
    setEditingChannel(channel);
    setChannelTierPrices(
      Object.fromEntries(
        pricingTiers.map((tier) => [
          tier,
          channel.tierPrices[tier].overridden
            ? channel.tierPrices[tier].priceAmount / 100
            : null,
        ]),
      ) as Record<PricingTier, number | null>,
    );
  }
  async function saveChannelPrice() {
    if (!editingChannel) return;
    await patch(
      `/api/v1/admin/publication-channels/${editingChannel.id}`,
      {
        name: editingChannel.name,
        category: editingChannel.category,
        priceAmount: editingChannel.priceAmount,
        status: editingChannel.status,
        tierPrices: Object.fromEntries(
          pricingTiers.map((tier) => [
            tier,
            channelTierPrices[tier] === null
              ? null
              : Math.round(channelTierPrices[tier]! * 100),
          ]),
        ),
      },
      `channel-${editingChannel.id}`,
    );
    setEditingChannel(null);
  }
  async function toggleChannel(channel: Channel) {
    await patch(
      `/api/v1/admin/publication-channels/${channel.id}`,
      {
        name: channel.name,
        category: channel.category,
        priceAmount: channel.priceAmount,
        status: channel.status === "active" ? "inactive" : "active",
        tierPrices: Object.fromEntries(
          pricingTiers.map((tier) => [
            tier,
            channel.tierPrices[tier].overridden
              ? channel.tierPrices[tier].priceAmount
              : null,
          ]),
        ),
      },
      `channel-${channel.id}`,
    );
  }
  function openPricingTierRule(rule: PricingTierRule) {
    setEditingPricingTier(rule);
    pricingTierRuleForm.setFieldsValue({
      displayName: rule.displayName,
      publicationMarkupPercent: rule.publicationMarkupBps / 100,
      pointMarkupPercent: rule.pointMarkupBps / 100,
    });
  }
  async function savePricingTierRule(values: PricingTierRuleForm) {
    if (!editingPricingTier) return;
    setBusy(`pricing-tier-${editingPricingTier.tier}`);
    try {
      await api("/api/v1/admin/pricing-tier-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tier: editingPricingTier.tier,
          displayName: values.displayName,
          publicationMarkupBps: Math.round(
            values.publicationMarkupPercent * 100,
          ),
          pointMarkupBps: Math.round(values.pointMarkupPercent * 100),
        }),
      });
      setEditingPricingTier(null);
      pricingTierRuleForm.resetFields();
      setMessage("分级发布与积分加价规则已更新");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy("");
    }
  }
  const organizationColumns: TableColumnsType<Organization> = [
    {
      title: "腾讯企业",
      dataIndex: "name",
      width: 220,
      render: (value: string, item) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text code>{item.answerbitBrandId}</Typography.Text>
        </Space>
      ),
    },
    {
      title: "本平台范围",
      key: "platformScope",
      responsive: ["md"],
      width: 200,
      render: (_, item) => (
        <Typography.Text type="secondary">
          {item.memberCount} 名成员 · 1 个腾讯品牌
        </Typography.Text>
      ),
    },
    {
      title: "接入时间",
      dataIndex: "createdAt",
      responsive: ["md"],
      width: 130,
      render: (value: string) => new Date(value).toLocaleDateString(),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: string, item) => (
        <Badge
          status={
            value === "active" &&
            (!item.serviceExpiresAt ||
              dayjs(item.serviceExpiresAt).isAfter(dayjs()))
              ? "success"
              : "warning"
          }
          text={
            value !== "active"
              ? "已冻结"
              : item.serviceExpiresAt &&
                  !dayjs(item.serviceExpiresAt).isAfter(dayjs())
                ? "到期冻结"
                : "正常"
          }
        />
      ),
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: compactTable ? 240 : 400,
      render: (_, item) => (
        <Space size={compactTable ? 6 : 8}>
          <Button onClick={() => setValidityOrganization(item)}>有效期</Button>
          <Button
            aria-label={`管理企业 ${item.name}`}
            icon={compactTable ? <SettingOutlined /> : undefined}
            loading={detailLoading === "organization"}
            onClick={() => void openOrganization(item.id)}
          >
            {compactTable ? null : "管理"}
          </Button>
          <Button
            aria-label={`${item.status === "active" ? "冻结" : "恢复"}企业 ${item.name}`}
            danger={item.status === "active"}
            icon={
              compactTable ? (
                item.status === "active" ? (
                  <PauseCircleOutlined />
                ) : (
                  <PlayCircleOutlined />
                )
              ) : undefined
            }
            loading={busy === item.id}
            onClick={() =>
              void patch(
                "/api/v1/admin/organizations/" + item.id,
                {
                  status: item.status === "active" ? "suspended" : "active",
                },
                item.id,
              )
            }
          >
            {compactTable ? null : item.status === "active" ? "冻结" : "恢复"}
          </Button>
          {item.answerbitBrandId ? (
            <Button
              aria-label={`编辑企业 ${item.name}`}
              icon={compactTable ? <EditOutlined /> : undefined}
              loading={
                busy ===
                `platform-answerbit-brand-read-${item.answerbitBrandId}`
              }
              onClick={() =>
                void openPlatformBrandEditor(item.answerbitBrandId!)
              }
            >
              {compactTable ? null : "编辑"}
            </Button>
          ) : null}
          {item.answerbitBrandId ? (
            <Button
              aria-label={`更新企业 ${item.name} 的 Logo`}
              icon={compactTable ? <PictureOutlined /> : undefined}
              onClick={() => {
                setPlatformBrandIcon(null);
                setPlatformBrandIconError("");
                setEditingPlatformBrandIcon({
                  brandId: item.answerbitBrandId!,
                  brandName: item.answerbitBrandName ?? item.name,
                });
              }}
            >
              {compactTable ? null : "Logo"}
            </Button>
          ) : null}
          {item.answerbitBrandId ? (
            <Popconfirm
              cancelText="取消"
              description="将先调用腾讯删除品牌；腾讯成功后关闭平台企业投影并保留历史业务数据。"
              okButtonProps={{ danger: true }}
              okText="删除腾讯企业"
              onConfirm={() =>
                void deletePlatformAnswerbitBrand({
                  brandId: item.answerbitBrandId!,
                  brandName: item.answerbitBrandName ?? item.name,
                })
              }
              title={`确认删除 ${item.answerbitBrandName ?? item.name}？`}
            >
              <Button
                aria-label={`删除企业 ${item.name}`}
                danger
                icon={compactTable ? <DeleteOutlined /> : undefined}
                loading={
                  busy ===
                  `platform-answerbit-brand-delete-${item.answerbitBrandId}`
                }
              >
                {compactTable ? null : "删除"}
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  const userColumns: TableColumnsType<User> = [
    {
      title: "账户",
      dataIndex: "name",
      width: 260,
      render: (value: string, item) => (
        <Space size={12}>
          <Avatar size={40}>{value.slice(0, 1).toUpperCase()}</Avatar>
          <Space direction="vertical" size={0}>
            <Typography.Text strong>{value}</Typography.Text>
            <Typography.Text type="secondary">
              {"@" + (item.username ?? "legacy")}
            </Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "身份与角色",
      key: "identity",
      width: 210,
      render: (_, item) => (
        <Space size={[0, 4]} wrap>
          <Tag color={accountTypeMeta[item.accountType].color}>
            {accountTypeMeta[item.accountType].label}
          </Tag>
          <Tag color={pricingTierMeta[item.pricingTier].color}>
            {pricingTierMeta[item.pricingTier].label}
          </Tag>
          {item.platformRole ? (
            <Tag color="purple">
              {roleLabels[item.platformRole] ?? item.platformRole}
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: "授权范围",
      key: "scope",
      responsive: ["md"],
      width: 210,
      render: (_, item) => (
        <Space split={<Typography.Text type="secondary">·</Typography.Text>}>
          <Typography.Text>{item.organizationCount} 家企业</Typography.Text>
          <Typography.Text>{item.brandCount} 个品牌权限</Typography.Text>
        </Space>
      ),
    },
    {
      title: "代理商有效期",
      key: "agentValidity",
      responsive: ["lg"],
      width: 220,
      render: (_, item) => {
        if (item.accountType !== "agent")
          return <Typography.Text type="secondary">不适用</Typography.Text>;
        if (!item.agentValidFrom && !item.agentExpiresAt)
          return <Tag color="success">长期有效</Tag>;
        const state = effectiveUserStatus(item);
        return (
          <Space direction="vertical" size={0}>
            <Tag
              color={
                state === "expired"
                  ? "error"
                  : state === "scheduled"
                    ? "processing"
                    : "success"
              }
            >
              {effectiveStatusMeta[state].label}
            </Tag>
            <Typography.Text type="secondary">
              {item.agentValidFrom
                ? new Date(item.agentValidFrom).toLocaleString()
                : "立即生效"}
              {" → "}
              {item.agentExpiresAt
                ? new Date(item.agentExpiresAt).toLocaleString()
                : "长期"}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      responsive: ["lg"],
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (_, item) => {
        const state = effectiveUserStatus(item);
        return (
          <Badge
            status={effectiveStatusMeta[state].badge}
            text={effectiveStatusMeta[state].label}
          />
        );
      },
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 210,
      render: (_, item) => (
        <Space>
          <Button
            aria-label={`管理用户 ${item.name}`}
            loading={detailLoading === "user"}
            onClick={() => void openUser(item.id)}
          >
            管理
          </Button>
          <AdminAccountStatusAction
            user={item}
            currentUserId={userId}
            onChanged={async () => {
              await load();
              if (userDetail?.user.id === item.id) await openUser(item.id);
            }}
            onManageOrganization={(id) => void openOrganization(id)}
          />
        </Space>
      ),
    },
  ];

  const channelColumns: TableColumnsType<Channel> = [
    {
      title: "渠道",
      dataIndex: "name",
      width: 260,
      render: (value: string, item) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          <Space size={4} wrap>
            <Tag>{item.category}</Tag>
            {item.providerMediaType ? (
              <Tag color="blue">
                {item.providerMediaType === "website" ? "网站媒体" : "自媒体"}
              </Tag>
            ) : null}
            {Object.values(item.providerMetadata?.fieldTitles ?? {})
              .flat()
              .slice(0, 2)
              .map((label) => (
                <Tag color="cyan" key={label}>
                  {label}
                </Tag>
              ))}
          </Space>
        </Space>
      ),
    },
    {
      title: "来源",
      dataIndex: "provider",
      width: 105,
      render: (value: string) =>
        value === "frog_media" ? "媒体发布" : "人工渠道",
    },
    {
      title: "采购成本",
      dataIndex: "providerCostAmount",
      width: 110,
      render: (value: number, item) =>
        item.provider === "frog_media" ? money(value) : "自营",
    },
    {
      title: "分级售价",
      key: "tierPrices",
      width: 380,
      render: (_, item) => (
        <Space size={[4, 6]} wrap>
          {pricingTiers.map((tier) => (
            <Tag color={pricingTierMeta[tier].color} key={tier}>
              {pricingTierMeta[tier].label}{" "}
              {money(item.tierPrices[tier].priceAmount)}
              {item.tierPrices[tier].overridden ? " · 自定义" : ""}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 135,
      render: (value: string, item) => (
        <Space direction="vertical" size={2}>
          <Badge
            status={value === "active" ? "success" : "default"}
            text={value === "active" ? "平台启用" : "平台下架"}
          />
          {item.provider === "frog_media" ? (
            <Badge
              status={item.providerStatus === "active" ? "processing" : "error"}
              text={item.providerStatus === "active" ? "上游可用" : "上游下架"}
            />
          ) : null}
        </Space>
      ),
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      render: (_, item) => (
        <Space>
          <Button onClick={() => openChannelPrice(item)}>分级定价</Button>
          <Button onClick={() => void toggleChannel(item)}>
            {item.status === "active" ? "下架" : "启用"}
          </Button>
        </Space>
      ),
    },
  ];

  const balanceTransactionUsers = [
    ...new Map(directoryUsers.map((item) => [item.id, item])).values(),
  ].map((item) => ({
    label: `${item.name}${item.username ? ` (@${item.username})` : ""}`,
    value: item.id,
  }));
  const navigation = (
    <Menu
      className="admin-platform-navigation"
      items={adminMenuItems}
      mode="inline"
      onClick={({ key }) => selectTab(key)}
      selectedKeys={[tab]}
      style={{ borderInlineEnd: 0 }}
    />
  );

  const sidebar = (
    <div className="admin-platform-sidebar-panel">
      <div className="admin-platform-brand-block">
        <Typography.Text className="admin-platform-wordmark" strong>
          Answerbit
        </Typography.Text>
        <Typography.Text
          className="admin-platform-brand-caption"
          type="secondary"
        >
          AI 品牌增长平台
        </Typography.Text>
        <div className="admin-platform-console-chip">
          <Avatar
            className="admin-platform-console-avatar"
            icon={<SafetyCertificateOutlined />}
            shape="square"
            size={28}
          />
          <div>
            <Typography.Text ellipsis strong>
              平台控制台
            </Typography.Text>
            <Typography.Text ellipsis type="secondary">
              全局资源与运营中心
            </Typography.Text>
          </div>
        </div>
      </div>

      <div className="admin-platform-navigation-scroll">{navigation}</div>

      <Divider className="admin-platform-sidebar-divider" />
      <div className="admin-platform-sidebar-footer">
        <div className="admin-platform-user-summary">
          <Avatar className="admin-platform-user-avatar" size={32}>
            {userName.slice(0, 1).toUpperCase()}
          </Avatar>
          <div>
            <Typography.Text ellipsis strong>
              {userName}
            </Typography.Text>
            <Typography.Text ellipsis type="secondary">
              平台超级管理员
            </Typography.Text>
          </div>
        </div>
        <Space className="admin-platform-utility-actions" size={2}>
          <Tooltip title="切换主题">
            <span>
              <ThemeToggle />
            </span>
          </Tooltip>
          <Tooltip title="客户工作台">
            <Button
              aria-label="返回客户工作台"
              disabled={!platformReady}
              href="/dashboard"
              icon={<ArrowLeftOutlined />}
              type="text"
            />
          </Tooltip>
          <Tooltip title="刷新当前模块">
            <Button
              aria-label="刷新当前模块"
              icon={<ReloadOutlined />}
              loading={loading}
              onClick={() => void load()}
              type="text"
            />
          </Tooltip>
        </Space>
      </div>
    </div>
  );

  return (
    <Layout className="admin-platform-shell">
      {validityOrganization ? (
        <EnterpriseValidity
          key={validityOrganization.id}
          organization={validityOrganization}
          onClose={() => setValidityOrganization(null)}
          onSaved={() => {
            setValidityOrganization(null);
            setMessage("企业有效期已更新");
            void load();
            if (organizationDetail)
              void openOrganization(organizationDetail.organization.id);
          }}
        />
      ) : null}
      <Modal
        title="修改用户名称"
        open={Boolean(editingUserName)}
        onCancel={() => setEditingUserName(null)}
        onOk={() => void saveUserName()}
        confirmLoading={busy === "user-name"}
        okButtonProps={{ disabled: !editingUserName?.name.trim() }}
        destroyOnHidden
      >
        <Typography.Paragraph type="secondary">
          修改显示名称，登录账号保持原值。
        </Typography.Paragraph>
        <Input
          aria-label="用户名称"
          maxLength={120}
          value={editingUserName?.name ?? ""}
          onChange={(event) => {
            const name = event.target.value;
            setEditingUserName((current) =>
              current ? { ...current, name } : null,
            );
          }}
          onPressEnter={() => void saveUserName()}
        />
      </Modal>
      {desktopNavigation ? (
        <Layout.Sider
          className="admin-platform-sidebar"
          theme="light"
          trigger={null}
          width={280}
        >
          {sidebar}
        </Layout.Sider>
      ) : null}

      <Layout className="admin-platform-main-layout">
        {!desktopNavigation ? (
          <Layout.Header className="admin-platform-mobile-header">
            <Space size={8}>
              <Button
                aria-label="打开平台导航"
                icon={<MenuOutlined />}
                onClick={() => setMobileMenuOpen(true)}
                type="text"
              />
              <Typography.Text className="admin-platform-wordmark" strong>
                Answerbit
              </Typography.Text>
            </Space>
            <Space size={4}>
              <ThemeToggle />
              <Avatar className="admin-platform-user-avatar" size={28}>
                {userName.slice(0, 1).toUpperCase()}
              </Avatar>
            </Space>
          </Layout.Header>
        ) : null}

        <Layout.Content className="admin-platform-content">
          <div className="admin-platform-content-frame">
            <Flex
              className="admin-platform-workspace"
              gap={20}
              style={{ width: "100%" }}
              vertical
            >
              <Flex
                align="flex-end"
                className="admin-platform-page-header"
                gap={16}
                justify="space-between"
                wrap
              >
                <div className="admin-platform-page-heading">
                  <Typography.Text type="secondary">
                    {activeSection.eyebrow}
                  </Typography.Text>
                  <Typography.Title level={1}>
                    {activeSection.title}
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    {activeSection.description}
                  </Typography.Text>
                </div>
                <Space className="admin-platform-page-actions" wrap>
                  <Tag
                    color={platformReady ? "success" : "warning"}
                    icon={<ApiOutlined />}
                  >
                    {platformReady ? "腾讯服务正常" : "等待腾讯服务接入"}
                  </Tag>
                  <Button
                    icon={<ReloadOutlined />}
                    loading={loading}
                    onClick={() => void load()}
                  >
                    刷新数据
                  </Button>
                </Space>
              </Flex>

              {message ? (
                <Alert
                  closable
                  message={message}
                  onClose={() => setMessage("")}
                  showIcon
                  type="info"
                />
              ) : null}

              {platformReady && tab === "overview" ? (
                <Flex gap={16} vertical>
                  <Row gutter={[16, 16]}>
                    <Col lg={4} md={8} xs={12}>
                      <Card className="admin-platform-stat-card">
                        <Statistic
                          title="腾讯企业"
                          value={overview?.organizations ?? 0}
                        />
                      </Card>
                    </Col>
                    <Col lg={4} md={8} xs={12}>
                      <Card className="admin-platform-stat-card">
                        <Statistic
                          suffix={
                            <Typography.Text type="secondary">
                              / {overview?.users ?? 0}
                            </Typography.Text>
                          }
                          title="有效用户"
                          value={overview?.activeUsers ?? 0}
                        />
                      </Card>
                    </Col>
                    <Col lg={4} md={8} xs={12}>
                      <Card className="admin-platform-stat-card">
                        <Statistic
                          title="有效成员关系"
                          value={overview?.activeMemberships ?? 0}
                        />
                      </Card>
                    </Col>
                    <Col lg={4} md={8} xs={12}>
                      <Card className="admin-platform-stat-card">
                        <Statistic
                          suffix="%"
                          title="24 小时失败率"
                          value={overview?.answerbitFailureRate24h ?? 0}
                          valueStyle={
                            (overview?.answerbitFailureRate24h ?? 0) > 0
                              ? { color: token.colorError }
                              : undefined
                          }
                        />
                      </Card>
                    </Col>
                    <Col lg={4} md={8} xs={12}>
                      <Card className="admin-platform-stat-card">
                        <Statistic
                          suffix="个"
                          title="在线 Worker"
                          value={overview?.liveWorkerInstances ?? 0}
                          valueStyle={
                            overview && !workerHealthy
                              ? { color: token.colorError }
                              : undefined
                          }
                        />
                      </Card>
                    </Col>
                    <Col lg={4} md={8} xs={12}>
                      <Card className="admin-platform-stat-card">
                        <Statistic
                          title="检测异常规则"
                          value={
                            (overview?.failedNotificationRules ?? 0) +
                            (overview?.staleNotificationRules ?? 0)
                          }
                          valueStyle={
                            notificationHealthy
                              ? undefined
                              : { color: token.colorError }
                          }
                        />
                      </Card>
                    </Col>
                  </Row>

                  <Row gutter={[16, 16]}>
                    <Col xl={14} xs={24}>
                      <Card
                        className="admin-platform-panel"
                        extra={
                          <Badge
                            status={
                              !overview
                                ? "processing"
                                : runtimeHealthy
                                  ? "success"
                                  : "error"
                            }
                            text={
                              !overview
                                ? "检查中"
                                : runtimeHealthy
                                  ? "运行正常"
                                  : "需要处理"
                            }
                          />
                        }
                        title="平台运行状态"
                      >
                        <Descriptions column={mobile ? 1 : 2} size="small">
                          <Descriptions.Item label="固定 TeamID">
                            <Typography.Text code copyable>
                              {platformConfiguration?.teamId ?? "未配置"}
                            </Typography.Text>
                          </Descriptions.Item>
                          <Descriptions.Item label="统一密钥">
                            {platformConfiguration?.apiKeyHint ?? "未配置"}
                          </Descriptions.Item>
                          <Descriptions.Item label="腾讯企业目录">
                            {platformConfiguration?.summary.brandCount ?? 0} 个
                          </Descriptions.Item>
                          <Descriptions.Item label="最近目录同步">
                            {platformConfiguration?.lastSyncedAt
                              ? new Date(
                                  platformConfiguration.lastSyncedAt,
                                ).toLocaleString()
                              : "等待首次同步"}
                          </Descriptions.Item>
                          <Descriptions.Item label="Worker 实例">
                            <Badge
                              status={
                                !overview
                                  ? "processing"
                                  : workerHealthy
                                    ? "success"
                                    : "error"
                              }
                              text={
                                !overview
                                  ? "检查中"
                                  : workerHealthy
                                    ? `${overview?.liveWorkerInstances ?? 0} 个在线`
                                    : overview?.workerStatus === "stale"
                                      ? "心跳已过期"
                                      : "尚无心跳"
                              }
                            />
                          </Descriptions.Item>
                          <Descriptions.Item label="最近 Worker 心跳">
                            {overview?.lastWorkerHeartbeatAt
                              ? new Date(
                                  overview.lastWorkerHeartbeatAt,
                                ).toLocaleString()
                              : "等待 Worker 启动"}
                          </Descriptions.Item>
                          <Descriptions.Item label="后台周期任务">
                            {overview
                              ? `${overview.healthyRuntimeTasks ?? 0} / ${runtimeTasks.length} 项正常`
                              : "正在检查"}
                          </Descriptions.Item>
                          <Descriptions.Item label="异步作业队列">
                            文章待处理 {overview?.queuedArticleJobs ?? 0} ·
                            执行中 {overview?.runningArticleJobs ?? 0} · 异常{" "}
                            {overview?.staleArticleJobs ?? 0}；报表待处理{" "}
                            {overview?.queuedReportJobs ?? 0} · 执行中{" "}
                            {overview?.runningReportJobs ?? 0} · 异常{" "}
                            {overview?.staleReportJobs ?? 0}
                          </Descriptions.Item>
                          <Descriptions.Item label="持续检测规则">
                            {overview?.enabledNotificationRules ?? 0} 条启用 ·{" "}
                            {overview?.failedNotificationRules ?? 0} 条失败 ·{" "}
                            {overview?.staleNotificationRules ?? 0} 条过期
                          </Descriptions.Item>
                          <Descriptions.Item label="AnswerBit 近 24 小时">
                            {overview?.failedAnswerbitCalls24h ?? 0} /{" "}
                            {overview?.answerbitCalls24h ?? 0} 次失败 · P95{" "}
                            {overview?.answerbitP95DurationMs24h ?? 0}ms
                          </Descriptions.Item>
                        </Descriptions>
                        <Alert
                          description={
                            !overview
                              ? "正在读取 Worker 心跳、通知规则和 AnswerBit 调用健康数据。"
                              : runtimeHealthy
                                ? "Worker 心跳、后台周期任务、通知规则评估和统一腾讯接入均处于可运行状态。"
                                : !workerHealthy
                                  ? "未检测到 90 秒内的 Worker 心跳，文章生成、报告导出、目录同步与持续检测可能停止，请检查 Worker 进程。"
                                  : !runtimeTasksHealthy
                                    ? `Worker 在线，但有 ${overview.failedRuntimeTasks ?? 0} 项后台任务失败、${overview.staleRuntimeTasks ?? 0} 项超时、${overview.missingRuntimeTasks ?? 0} 项未上报，请进入运行与审计查看详情。`
                                    : !asyncJobsHealthy
                                      ? `Worker 在线，但有 ${overview.staleAsyncJobs ?? 0} 个文章生成或报表导出作业超过恢复阈值，请检查异步任务恢复状态。`
                                      : "Worker 在线，但存在评估失败或超过 30 分钟未评估的通知规则，请进入通知中心查看错误码。"
                          }
                          message={
                            !overview
                              ? "正在检查平台运行状态"
                              : runtimeHealthy
                                ? "异步处理与持续检测正常"
                                : !workerHealthy
                                  ? "Worker 运行异常"
                                  : !runtimeTasksHealthy
                                    ? "后台周期任务需要处理"
                                    : !asyncJobsHealthy
                                      ? "异步作业队列需要处理"
                                      : "持续检测规则需要处理"
                          }
                          showIcon
                          style={{ marginTop: 16 }}
                          type={
                            !overview
                              ? "info"
                              : runtimeHealthy
                                ? "success"
                                : "warning"
                          }
                        />
                        <Space style={{ marginTop: 16 }} wrap>
                          <Button
                            icon={<BankOutlined />}
                            onClick={() => selectTab("organizations")}
                            type="primary"
                          >
                            管理企业与品牌
                          </Button>
                          <Button
                            icon={<FundOutlined />}
                            onClick={() => selectTab("metering")}
                          >
                            查看腾讯用量
                          </Button>
                          <Button
                            icon={<ApiOutlined />}
                            onClick={() => selectTab("integration")}
                          >
                            查看腾讯服务
                          </Button>
                        </Space>
                      </Card>
                    </Col>
                    <Col xl={10} xs={24}>
                      <Card
                        className="admin-platform-panel admin-platform-account-card"
                        extra={
                          <Button
                            onClick={() => selectTab("users")}
                            type="link"
                          >
                            进入客户与代理管理
                          </Button>
                        }
                        title="账户结构"
                      >
                        <Row gutter={[12, 16]}>
                          <Col span={8}>
                            <Statistic
                              title="管理员"
                              value={overview?.adminUsers ?? 0}
                            />
                          </Col>
                          <Col span={8}>
                            <Statistic
                              title="代理商"
                              value={overview?.agentUsers ?? 0}
                            />
                          </Col>
                          <Col span={8}>
                            <Statistic
                              title="客户"
                              value={overview?.customerUsers ?? 0}
                            />
                          </Col>
                        </Row>
                        <Alert
                          description={`${overview?.scheduledAgents ?? 0} 个代理商尚未生效，${overview?.expiredAgents ?? 0} 个代理商已过期。`}
                          message={`${overview?.disabledUsers ?? 0} 个账户已停用`}
                          showIcon
                          style={{ marginTop: 20 }}
                          type={
                            (overview?.disabledUsers ?? 0) +
                              (overview?.scheduledAgents ?? 0) +
                              (overview?.expiredAgents ?? 0) >
                            0
                              ? "warning"
                              : "info"
                          }
                        />
                      </Card>
                    </Col>
                  </Row>

                  <Row gutter={[16, 16]}>
                    <Col xl={12} xs={24}>
                      <Card
                        className="admin-platform-panel"
                        extra={
                          <Button
                            onClick={() => selectTab("operations")}
                            type="link"
                          >
                            查看全部
                          </Button>
                        }
                        title="最近平台操作"
                      >
                        <Table<AuditRow>
                          columns={[
                            {
                              title: "操作",
                              dataIndex: ["log", "operation"],
                              width: 220,
                              render: (value: string, item) => (
                                <Space direction="vertical" size={0}>
                                  <Typography.Text strong>
                                    {value}
                                  </Typography.Text>
                                  <Typography.Text ellipsis type="secondary">
                                    {item.log.summary ?? item.log.resourceType}
                                  </Typography.Text>
                                </Space>
                              ),
                            },
                            {
                              title: "操作者",
                              dataIndex: "actorName",
                              width: 110,
                            },
                            {
                              title: "结果",
                              dataIndex: ["log", "result"],
                              width: 80,
                              render: (value: string) => (
                                <Tag
                                  color={
                                    value === "success" ? "success" : "error"
                                  }
                                >
                                  {value === "success" ? "成功" : "失败"}
                                </Tag>
                              ),
                            },
                          ]}
                          dataSource={audits}
                          pagination={false}
                          rowKey={(item) => item.log.id}
                          onHeaderRow={focusableTableHeaderRow}
                          scroll={{ x: 410 }}
                          size="small"
                        />
                      </Card>
                    </Col>
                    <Col xl={12} xs={24}>
                      <Card
                        className="admin-platform-panel"
                        extra={
                          <Button
                            onClick={() => selectTab("operations")}
                            type="link"
                          >
                            查看全部
                          </Button>
                        }
                        title="最近 AnswerBit 调用"
                      >
                        <Table<CallRow>
                          columns={[
                            {
                              title: "接口",
                              dataIndex: ["call", "operation"],
                              width: 210,
                            },
                            {
                              title: "企业",
                              dataIndex: "organizationName",
                              width: 130,
                            },
                            {
                              title: "耗时",
                              dataIndex: ["call", "durationMs"],
                              width: 72,
                              render: (value: number) => `${value}ms`,
                            },
                            {
                              title: "状态",
                              dataIndex: ["call", "status"],
                              width: 80,
                              render: (value: string) => (
                                <Tag
                                  color={
                                    value === "success" ? "success" : "error"
                                  }
                                >
                                  {value === "success"
                                    ? "成功"
                                    : value === "timeout"
                                      ? "超时"
                                      : "失败"}
                                </Tag>
                              ),
                            },
                          ]}
                          dataSource={calls}
                          pagination={false}
                          rowKey={(item) => item.call.id}
                          onHeaderRow={focusableTableHeaderRow}
                          scroll={{ x: 492 }}
                          size="small"
                        />
                      </Card>
                    </Col>
                  </Row>
                </Flex>
              ) : null}

              {tab === "organizations" ? (
                <Card
                  className="admin-platform-panel"
                  extra={
                    <Space wrap>
                      <Button
                        aria-label="新增腾讯企业"
                        disabled={platformConfiguration?.status !== "active"}
                        icon={<PlusOutlined />}
                        onClick={() => setPlatformBrandCreateOpen(true)}
                        type="primary"
                      >
                        {mobile ? null : "新增腾讯企业"}
                      </Button>
                      <Button
                        aria-label="打开腾讯接入设置"
                        icon={<ApiOutlined />}
                        onClick={() => selectTab("integration")}
                      >
                        {mobile ? null : "接入设置"}
                      </Button>
                    </Space>
                  }
                  title="腾讯企业目录"
                >
                  <Flex
                    gap={12}
                    justify="space-between"
                    style={{ marginBottom: 20 }}
                    wrap
                  >
                    <Input.Search
                      allowClear
                      enterButton="搜索"
                      onChange={(event) => {
                        const value = event.target.value;
                        setOrganizationQueryDraft(value);
                        if (!value && organizationQuery) {
                          setPage(1);
                          setOrganizationQuery("");
                        }
                      }}
                      onSearch={(value) => {
                        setPage(1);
                        setOrganizationQuery(value.trim());
                      }}
                      placeholder="搜索企业名称或内部标识"
                      style={{ maxWidth: 420, minWidth: mobile ? "100%" : 320 }}
                      value={organizationQueryDraft}
                    />
                    <Space wrap>
                      <Select
                        aria-label="筛选企业状态"
                        onChange={(value) => {
                          setPage(1);
                          setOrganizationStatus(value);
                        }}
                        options={[
                          { label: "全部状态", value: "all" },
                          { label: "正常", value: "active" },
                          { label: "已冻结", value: "suspended" },
                        ]}
                        style={{ width: 128 }}
                        value={organizationStatus}
                      />
                      {organizationQuery || organizationStatus !== "all" ? (
                        <Button
                          onClick={() => {
                            setPage(1);
                            setOrganizationQueryDraft("");
                            setOrganizationQuery("");
                            setOrganizationStatus("all");
                          }}
                          type="text"
                        >
                          重置筛选
                        </Button>
                      ) : null}
                    </Space>
                  </Flex>
                  <Table<Organization>
                    columns={organizationColumns}
                    dataSource={organizations}
                    onChange={(pagination) => {
                      setPage(pagination.current ?? 1);
                      setPageSize(pagination.pageSize ?? 20);
                    }}
                    pagination={{
                      current: page,
                      pageSize,
                      showSizeChanger: true,
                      showTotal: (value) => `共 ${value} 家腾讯企业`,
                      total,
                    }}
                    rowKey="id"
                    onHeaderRow={focusableTableHeaderRow}
                    scroll={{ x: compactTable ? 900 : 1060 }}
                  />
                </Card>
              ) : null}

              {tab === "library" ? (
                <AdminDocumentLibrary
                  userId={userId}
                  organizations={meteringOrganizations}
                  onMessage={setMessage}
                />
              ) : null}

              {tab === "metering" ? (
                <MeteringClient
                  canViewPlatformAccount
                  organizations={meteringOrganizations}
                  showCapacityExpansion
                />
              ) : null}

              {tab === "users" ? (
                <Flex gap={16} vertical>
                  <Row gutter={[16, 16]}>
                    <Col lg={6} sm={12} xs={24}>
                      <Card size="small">
                        <Statistic
                          title="全部账户"
                          value={overview?.users ?? 0}
                        />
                      </Card>
                    </Col>
                    <Col lg={6} sm={12} xs={24}>
                      <Card size="small">
                        <Statistic
                          suffix={
                            <Typography.Text type="secondary">
                              /{" "}
                              {(overview?.disabledUsers ?? 0) +
                                (overview?.scheduledAgents ?? 0) +
                                (overview?.expiredAgents ?? 0)}{" "}
                              受限
                            </Typography.Text>
                          }
                          title="正常账户"
                          value={overview?.activeUsers ?? 0}
                        />
                      </Card>
                    </Col>
                    <Col lg={6} sm={12} xs={24}>
                      <Card size="small">
                        <Statistic
                          title="管理员 / 代理商"
                          value={`${overview?.adminUsers ?? 0} / ${overview?.agentUsers ?? 0}`}
                        />
                        <Typography.Text type="secondary">
                          {overview?.scheduledAgents ?? 0} 未生效 ·{" "}
                          {overview?.expiredAgents ?? 0} 已过期
                        </Typography.Text>
                      </Card>
                    </Col>
                    <Col lg={6} sm={12} xs={24}>
                      <Card size="small">
                        <Statistic
                          title="客户账户"
                          value={overview?.customerUsers ?? 0}
                        />
                      </Card>
                    </Col>
                  </Row>

                  <Card
                    className="admin-platform-panel"
                    extra={
                      <Typography.Text type="secondary">
                        分别设置发布和积分加价率
                      </Typography.Text>
                    }
                    title="客户等级与利润策略"
                  >
                    <Alert
                      message="客户等级在用户目录中分配；渠道自定义售价优先于等级加价规则，媒体发布渠道同步不会覆盖平台定价。"
                      showIcon
                      style={{ marginBottom: 16 }}
                      type="success"
                    />
                    <Table<PricingTierRule>
                      columns={[
                        {
                          title: "客户等级",
                          dataIndex: "tier",
                          render: (tier: PricingTier, rule) => (
                            <Space>
                              <Tag color={pricingTierMeta[tier].color}>
                                {rule.displayName}
                              </Tag>
                              <Typography.Text type="secondary">
                                {tier}
                              </Typography.Text>
                            </Space>
                          ),
                        },
                        {
                          title: "发布加价",
                          dataIndex: "publicationMarkupBps",
                          render: (value: number) => `${value / 100}%`,
                        },
                        {
                          title: "积分加价率",
                          dataIndex: "pointMarkupBps",
                          render: (value: number) => `${value / 100}%`,
                        },
                        {
                          title: "示例",
                          key: "example",
                          responsive: ["md"],
                          render: (_, rule) =>
                            `采购 ¥100 → 售价 ¥${(
                              100 *
                              (1 + rule.publicationMarkupBps / 10_000)
                            ).toFixed(
                              2,
                            )}；基础 100 积分 → ${calculateMarkedUpPoints(
                              100,
                              rule.pointMarkupBps,
                            )} 积分`,
                        },
                        {
                          title: "操作",
                          key: "action",
                          width: 110,
                          render: (_, rule) => (
                            <Button onClick={() => openPricingTierRule(rule)}>
                              设置规则
                            </Button>
                          ),
                        },
                      ]}
                      dataSource={pricingTierRules}
                      pagination={false}
                      rowKey="tier"
                      scroll={{ x: 880 }}
                      size="small"
                    />
                  </Card>

                  <Card
                    extra={
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => setUserCreateOpen(true)}
                        type="primary"
                      >
                        创建账户
                      </Button>
                    }
                    title="用户目录"
                  >
                    <Flex
                      gap={12}
                      justify="space-between"
                      style={{ marginBottom: 20 }}
                      wrap
                    >
                      <Input.Search
                        allowClear
                        enterButton="搜索"
                        onChange={(event) => {
                          const value = event.target.value;
                          setUserQueryDraft(value);
                          if (!value && userQuery) {
                            setPage(1);
                            setUserQuery("");
                          }
                        }}
                        onSearch={(value) => {
                          setPage(1);
                          setUserQuery(value.trim());
                        }}
                        placeholder="搜索姓名或登录账号"
                        style={{
                          maxWidth: 420,
                          minWidth: mobile ? "100%" : 320,
                        }}
                        value={userQueryDraft}
                      />
                      <Space wrap>
                        <Select
                          aria-label="筛选账户状态"
                          onChange={(value) => {
                            setPage(1);
                            setUserStatus(value);
                          }}
                          options={[
                            { label: "全部状态", value: "all" },
                            { label: "正常", value: "active" },
                            { label: "代理未生效", value: "scheduled" },
                            { label: "代理已过期", value: "expired" },
                            { label: "已停用", value: "disabled" },
                          ]}
                          style={{ width: 128 }}
                          value={userStatus}
                        />
                        <Select
                          aria-label="筛选账户类型"
                          onChange={(value) => {
                            setPage(1);
                            setUserAccountType(value);
                          }}
                          options={[
                            { label: "全部类型", value: "all" },
                            { label: "管理员", value: "admin" },
                            { label: "代理商", value: "agent" },
                            { label: "客户", value: "customer" },
                          ]}
                          style={{ width: 128 }}
                          value={userAccountType}
                        />
                        {userQuery ||
                        userStatus !== "all" ||
                        userAccountType !== "all" ? (
                          <Button
                            onClick={() => {
                              setPage(1);
                              setUserQueryDraft("");
                              setUserQuery("");
                              setUserStatus("all");
                              setUserAccountType("all");
                            }}
                            type="text"
                          >
                            重置筛选
                          </Button>
                        ) : null}
                      </Space>
                    </Flex>
                    <Table<User>
                      columns={userColumns}
                      dataSource={users}
                      loading={loading}
                      locale={{
                        emptyText: (
                          <Empty
                            description={
                              userQuery ||
                              userStatus !== "all" ||
                              userAccountType !== "all"
                                ? "没有符合筛选条件的用户"
                                : "还没有平台用户"
                            }
                          >
                            {userQuery ||
                            userStatus !== "all" ||
                            userAccountType !== "all" ? (
                              <Button
                                onClick={() => {
                                  setPage(1);
                                  setUserQueryDraft("");
                                  setUserQuery("");
                                  setUserStatus("all");
                                  setUserAccountType("all");
                                }}
                              >
                                清除筛选
                              </Button>
                            ) : (
                              <Button
                                onClick={() => setUserCreateOpen(true)}
                                type="primary"
                              >
                                创建首个账户
                              </Button>
                            )}
                          </Empty>
                        ),
                      }}
                      onChange={(pagination) => {
                        setPage(pagination.current ?? 1);
                        setPageSize(pagination.pageSize ?? 20);
                      }}
                      pagination={{
                        current: page,
                        pageSize,
                        showSizeChanger: true,
                        showTotal: (value, range) =>
                          `第 ${range[0]}–${range[1]} 名，共 ${value} 名用户`,
                        total,
                      }}
                      rowKey="id"
                      onHeaderRow={focusableTableHeaderRow}
                      scroll={{ x: 1250 }}
                    />
                  </Card>
                </Flex>
              ) : null}

              {tab === "integration" ? (
                <Flex gap={16} vertical>
                  <Alert
                    description={
                      platformReady
                        ? "固定 TeamID 与统一 API Key 已生效。平台直接调用腾讯接口，最终授权以腾讯官方控制台为准。"
                        : "填写固定 TeamID 与统一 API Key，并通过腾讯品牌接口验证。接入完成前，企业、用户、计费及业务模块保持锁定。"
                    }
                    message={
                      platformReady ? "腾讯接入正常" : "第一步：先完成腾讯接入"
                    }
                    showIcon
                    type={platformReady ? "success" : "warning"}
                  />
                  {platformReady ? (
                    <Row gutter={[16, 16]}>
                      <Col lg={8} sm={12} xs={24}>
                        <Card>
                          <Statistic
                            prefix={<KeyOutlined />}
                            title="统一接入"
                            value={platformConfiguration?.configured ? 1 : 0}
                            suffix="组"
                          />
                          <Space size={6}>
                            <Badge
                              status={
                                platformConfiguration?.status === "active"
                                  ? "success"
                                  : "default"
                              }
                            />
                            <Typography.Text type="secondary">
                              {platformConfiguration?.configured
                                ? `Key ${platformConfiguration.apiKeyHint}`
                                : "等待配置"}
                            </Typography.Text>
                          </Space>
                        </Card>
                      </Col>
                      <Col lg={8} sm={12} xs={24}>
                        <Card>
                          <Statistic
                            prefix={<CloudSyncOutlined />}
                            suffix="个"
                            title="腾讯企业目录"
                            value={
                              platformConfiguration?.summary.brandCount ?? 0
                            }
                          />
                          <Typography.Text type="secondary">
                            每 5 分钟自动同步
                            {platformConfiguration?.lastSyncedAt
                              ? ` · 最近 ${new Date(platformConfiguration.lastSyncedAt).toLocaleString()}`
                              : ""}
                          </Typography.Text>
                        </Card>
                      </Col>
                      <Col lg={8} sm={24} xs={24}>
                        <Card>
                          <Statistic
                            prefix={<BankOutlined />}
                            suffix="家"
                            title="平台企业"
                            value={
                              platformConfiguration?.summary
                                .assignedBrandCount ?? 0
                            }
                          />
                          <Typography.Text type="secondary">
                            与腾讯品牌一一对应
                          </Typography.Text>
                        </Card>
                      </Col>
                    </Row>
                  ) : null}

                  <Card
                    styles={{
                      header: {
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                      },
                    }}
                    title="平台统一腾讯接入"
                  >
                    <Form<PlatformCredentialForm>
                      form={platformCredentialForm}
                      layout="vertical"
                      onFinish={(values) =>
                        void savePlatformAnswerBitConfiguration(values)
                      }
                    >
                      <Row gutter={16}>
                        <Col lg={12} xs={24}>
                          <Form.Item
                            extra={
                              platformConfiguration?.configured
                                ? "TeamID 首次配置后已固定；可继续轮换 Key。"
                                : "首次验证时导入该 TeamID 下的腾讯企业目录。"
                            }
                            label="固定 Tencent TeamID"
                            name="teamId"
                            rules={[
                              { required: true, message: "请输入 TeamID" },
                            ]}
                          >
                            <Input
                              autoComplete="organization"
                              disabled={Boolean(
                                platformConfiguration?.configured,
                              )}
                              placeholder="腾讯团队唯一 ID"
                            />
                          </Form.Item>
                        </Col>
                        <Col lg={12} xs={24}>
                          <Alert
                            description="系统将直接调用已接入的全部 AnswerBit OpenAPI，不做本地二次权限裁剪；Key 的最终授权以腾讯官方控制台为准。"
                            message="OpenAPI 由系统直接接入"
                            showIcon
                            type="success"
                          />
                        </Col>
                      </Row>
                      <Form.Item
                        extra={
                          platformConfiguration?.configured
                            ? `当前密钥 ${platformConfiguration.apiKeyHint}，提交新值后完成轮换并重新验证。`
                            : "完整密钥只在本次提交使用，服务端使用独立平台 AAD 加密保存。"
                        }
                        label={
                          platformConfiguration?.configured
                            ? "轮换腾讯 AnswerBit API Key"
                            : "腾讯 AnswerBit API Key"
                        }
                        name="apiKey"
                        rules={[
                          {
                            required: true,
                            min: 16,
                            max: 512,
                            message: "请输入 16–512 位 API Key",
                          },
                        ]}
                      >
                        <Input.Password
                          autoComplete="new-password"
                          placeholder="输入后先调用腾讯品牌接口验证"
                        />
                      </Form.Item>
                      <Button
                        htmlType="submit"
                        icon={<KeyOutlined />}
                        loading={busy === "platform-answerbit-save"}
                        type="primary"
                      >
                        {platformConfiguration?.configured
                          ? "验证并更新统一配置"
                          : "验证并启用统一配置"}
                      </Button>
                    </Form>
                  </Card>

                  {platformReady ? (
                    <Card title="腾讯接入已完成">
                      <Alert
                        action={
                          <Button
                            onClick={() => selectTab("organizations")}
                            type="primary"
                          >
                            进入腾讯企业管理
                          </Button>
                        }
                        description="固定 TeamID 与统一 API Key 已验证。企业、用户、计费及业务模块已经开放；腾讯企业请在企业中心直接新增、编辑或删除。"
                        message="接入完成，平台已就绪"
                        showIcon
                        type="success"
                      />
                    </Card>
                  ) : null}
                </Flex>
              ) : null}

              {tab === "balances" ? (
                <Row gutter={[16, 16]}>
                  <Col xl={14} xs={24}>
                    <Card title="管理员入账">
                      <Table<Organization>
                        columns={[
                          {
                            title: "企业",
                            dataIndex: "name",
                            render: (value: string, item) => (
                              <Space direction="vertical" size={0}>
                                <Typography.Text strong>
                                  {value}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  积分池{" "}
                                  {balances.find(
                                    (account) =>
                                      account.organizationId === item.id &&
                                      account.brandId === null &&
                                      account.asset === "answerbit_points",
                                  )?.balance ?? 0}
                                  {" · 发布余额 "}
                                  {money(
                                    balances.find(
                                      (account) =>
                                        account.organizationId === item.id &&
                                        account.brandId === null &&
                                        account.asset === "publication_cny",
                                    )?.balance ?? 0,
                                  )}
                                </Typography.Text>
                              </Space>
                            ),
                          },
                          {
                            title: "操作",
                            key: "action",
                            width: 100,
                            render: (_, item) => (
                              <Button
                                onClick={() => {
                                  setGrantOrganization(item);
                                }}
                                type="primary"
                              >
                                入账 / 扣减
                              </Button>
                            ),
                          },
                        ]}
                        dataSource={organizations}
                        pagination={false}
                        rowKey="id"
                      />
                    </Card>
                  </Col>
                  <Col xl={10} xs={24}>
                    <Card title="业务功能积分规则">
                      <Table<PointCost>
                        columns={[
                          {
                            title: "功能",
                            dataIndex: "featureCode",
                            render: (value: string) =>
                              billableFeatures.find(
                                (feature) => feature.code === value,
                              )?.name ?? value,
                          },
                          { title: "积分/次", dataIndex: "points", width: 90 },
                          {
                            title: "说明",
                            dataIndex: "description",
                            responsive: ["md"],
                          },
                          {
                            title: "操作",
                            key: "action",
                            width: 76,
                            render: (_, item) => (
                              <Button
                                onClick={() => {
                                  costForm.setFieldsValue(item);
                                  document
                                    .getElementById("admin-cost-editor")
                                    ?.scrollIntoView({ block: "start" });
                                }}
                                size="small"
                                type="link"
                              >
                                编辑
                              </Button>
                            ),
                          },
                        ]}
                        dataSource={costs}
                        pagination={false}
                        rowKey="featureCode"
                        size="small"
                        style={{ marginTop: 20 }}
                      />
                    </Card>
                  </Col>
                  <Col span={24}>
                    <Card
                      extra={
                        <Space wrap>
                          <Select
                            allowClear
                            aria-label="按企业筛选平台余额流水"
                            onChange={(value) => {
                              setBalanceTransactionOrganizationId(value);
                              setBalanceTransactionPage(1);
                            }}
                            options={organizations.map((item) => ({
                              label: item.name,
                              value: item.id,
                            }))}
                            placeholder="全部企业"
                            showSearch
                            style={{ minWidth: 190 }}
                            value={balanceTransactionOrganizationId}
                          />
                          <Select
                            allowClear
                            aria-label="按操作用户筛选平台余额流水"
                            onChange={(value) => {
                              setBalanceTransactionUserId(value);
                              setBalanceTransactionPage(1);
                            }}
                            options={balanceTransactionUsers}
                            placeholder="全部用户"
                            showSearch
                            style={{ minWidth: 210 }}
                            value={balanceTransactionUserId}
                          />
                          <Select
                            aria-label="按资产筛选平台余额流水"
                            onChange={(value) => {
                              setBalanceTransactionAsset(value);
                              setBalanceTransactionPage(1);
                            }}
                            options={[
                              { label: "全部资产", value: "all" },
                              {
                                label: "腾讯能力积分",
                                value: "answerbit_points",
                              },
                              { label: "发布人民币", value: "publication_cny" },
                            ]}
                            style={{ width: 160 }}
                            value={balanceTransactionAsset}
                          />
                          <Select
                            aria-label="按操作类型筛选平台余额流水"
                            onChange={(value) => {
                              setBalanceTransactionOperation(value);
                              setBalanceTransactionPage(1);
                            }}
                            options={[
                              { label: "全部操作", value: "all" },
                              { label: "平台入账", value: "grant" },
                              { label: "品牌划拨", value: "allocate" },
                              { label: "能力扣减", value: "consume" },
                              { label: "失败返还", value: "restore" },
                              { label: "人工调整", value: "adjust" },
                            ]}
                            style={{ width: 140 }}
                            value={balanceTransactionOperation}
                          />
                          <Typography.Text type="secondary">
                            共 {balanceTransactionTotal} 条
                          </Typography.Text>
                        </Space>
                      }
                      title="用户积分与余额流水"
                    >
                      <Table<BalanceTransaction>
                        columns={[
                          {
                            title: "发生时间",
                            dataIndex: "createdAt",
                            width: 180,
                            render: (value: string) =>
                              new Date(value).toLocaleString(),
                          },
                          {
                            title: "企业",
                            dataIndex: "organizationName",
                            width: 180,
                          },
                          {
                            title: "操作用户",
                            key: "actor",
                            width: 190,
                            render: (_, item) =>
                              item.actorUserId ? (
                                <Space direction="vertical" size={0}>
                                  <Typography.Text>
                                    {item.actorName ?? "未知用户"}
                                  </Typography.Text>
                                  {item.actorUsername ? (
                                    <Typography.Text type="secondary">
                                      @{item.actorUsername}
                                    </Typography.Text>
                                  ) : null}
                                </Space>
                              ) : (
                                <Typography.Text type="secondary">
                                  系统任务 / 历史记录
                                </Typography.Text>
                              ),
                          },
                          {
                            title: "类型",
                            dataIndex: "operation",
                            width: 110,
                            render: (value: BalanceTransaction["operation"]) =>
                              ({
                                grant: "平台入账",
                                allocate: "品牌划拨",
                                consume: "能力扣减",
                                restore: "失败返还",
                                adjust: "人工调整",
                              })[value],
                          },
                          {
                            title: "资产",
                            dataIndex: "asset",
                            width: 130,
                            render: (value: BalanceAccount["asset"]) =>
                              value === "answerbit_points"
                                ? "腾讯能力积分"
                                : "发布人民币",
                          },
                          { title: "说明", dataIndex: "reason" },
                          {
                            title: "数量",
                            dataIndex: "amount",
                            align: "right",
                            width: 130,
                            render: (value: number, item) => (
                              <Typography.Text
                                type={
                                  item.operation === "consume" ||
                                  item.referenceType === "admin_deduction"
                                    ? "danger"
                                    : item.operation === "grant" ||
                                        item.operation === "restore"
                                      ? "success"
                                      : undefined
                                }
                              >
                                {item.operation === "consume" ||
                                item.referenceType === "admin_deduction"
                                  ? "−"
                                  : item.operation === "grant" ||
                                      item.operation === "restore"
                                    ? "+"
                                    : ""}
                                {item.asset === "answerbit_points"
                                  ? value.toLocaleString()
                                  : money(value)}
                              </Typography.Text>
                            ),
                          },
                        ]}
                        dataSource={balanceTransactions}
                        locale={{
                          emptyText: (
                            <Empty
                              description="暂无用户积分与余额流水"
                              image={Empty.PRESENTED_IMAGE_SIMPLE}
                            />
                          ),
                        }}
                        onChange={(pagination) => {
                          setBalanceTransactionPage(pagination.current ?? 1);
                          setBalanceTransactionPageSize(
                            pagination.pageSize ?? 20,
                          );
                        }}
                        pagination={{
                          current: balanceTransactionPage,
                          pageSize: balanceTransactionPageSize,
                          showSizeChanger: true,
                          total: balanceTransactionTotal,
                        }}
                        rowKey="id"
                        onHeaderRow={focusableTableHeaderRow}
                        scroll={{ x: 1080 }}
                      />
                    </Card>
                  </Col>
                  <Col xs={24}>
                    <Card title="新增或编辑积分规则" id="admin-cost-editor">
                      {" "}
                      <Form<CostForm>
                        form={costForm}
                        layout="vertical"
                        onFinish={(values) => void saveCost(values)}
                      >
                        <Form.Item
                          htmlFor="admin-feature-cost-code"
                          label="计费功能（必选）"
                          name="featureCode"
                          rules={[
                            {
                              validator: (_, value) =>
                                value
                                  ? Promise.resolve()
                                  : Promise.reject(new Error("请选择计费功能")),
                            },
                          ]}
                        >
                          <Select
                            id="admin-feature-cost-code"
                            onChange={(featureCode) => {
                              const current = costs.find(
                                (item) => item.featureCode === featureCode,
                              );
                              if (current) costForm.setFieldsValue(current);
                            }}
                            options={billableFeatures.map((feature) => ({
                              label: `${feature.name} · ${
                                costs.find(
                                  (item) => item.featureCode === feature.code,
                                )?.points ?? feature.defaultPoints
                              } 积分`,
                              value: feature.code,
                            }))}
                            placeholder="选择业务功能"
                            showSearch
                          />
                        </Form.Item>
                        <Form.Item
                          label="每次积分"
                          name="points"
                          rules={[{ required: true }]}
                        >
                          <InputNumber min={0} style={{ width: "100%" }} />
                        </Form.Item>
                        <Form.Item label="说明" name="description">
                          <Input />
                        </Form.Item>
                        <Button
                          htmlType="submit"
                          loading={busy === "cost"}
                          type="primary"
                        >
                          保存规则
                        </Button>
                      </Form>
                    </Card>
                  </Col>
                </Row>
              ) : null}

              {tab === "publications" ? (
                <Row gutter={[16, 16]}>
                  <Col xs={24}>{renderPublicationWorkflow()}</Col>
                  <Col xl={16} xs={24}>
                    <Card
                      className="admin-platform-panel admin-publication-connection-card"
                      extra={
                        <Tag
                          color={
                            publicationProviderConfiguration?.configured
                              ? "success"
                              : "default"
                          }
                        >
                          {publicationProviderConfiguration?.configured
                            ? "已接入"
                            : "待配置"}
                        </Tag>
                      }
                      title="媒体发布接入设置"
                    >
                      <Row gutter={[24, 20]}>
                        <Col lg={10} xs={24}>
                          <Descriptions bordered column={1} size="small">
                            <Descriptions.Item label="配置来源">
                              {publicationProviderConfiguration?.source ===
                              "database"
                                ? "网页加密配置"
                                : publicationProviderConfiguration?.source ===
                                    "environment"
                                  ? "环境变量（可迁移到网页）"
                                  : "尚未配置"}
                            </Descriptions.Item>
                            <Descriptions.Item label="当前 Key">
                              {publicationProviderConfiguration?.apiKeyHint ??
                                "未保存"}
                            </Descriptions.Item>
                            <Descriptions.Item label="密钥版本">
                              {publicationProviderConfiguration?.keyVersion ||
                                "—"}
                            </Descriptions.Item>
                            <Descriptions.Item label="最近验证">
                              {publicationProviderConfiguration?.lastCheckedAt
                                ? new Date(
                                    publicationProviderConfiguration.lastCheckedAt,
                                  ).toLocaleString()
                                : "等待首次保存"}
                            </Descriptions.Item>
                          </Descriptions>
                          <Alert
                            message="Key 使用 APP_ENCRYPTION_KEY 加密保存，读取接口只返回掩码；保存前会验证余额、网站媒体、自媒体、分类及订单查询接口。"
                            showIcon
                            style={{ marginTop: 16 }}
                            type="info"
                          />
                        </Col>
                        <Col lg={14} xs={24}>
                          <Form<FrogCredentialForm>
                            form={frogCredentialForm}
                            layout="vertical"
                            onFinish={(values) =>
                              void saveFrogConfiguration(values)
                            }
                            size="large"
                          >
                            <Form.Item
                              htmlFor="admin-frog-base-url"
                              label="媒体发布接口地址（必填）"
                              name="baseUrl"
                              rules={[
                                { required: true, message: "请输入 API 地址" },
                                {
                                  type: "url",
                                  message: "请输入有效的 HTTP(S) 地址",
                                },
                              ]}
                            >
                              <Input
                                id="admin-frog-base-url"
                                placeholder="http://8.138.187.158:8082"
                              />
                            </Form.Item>
                            <Form.Item
                              extra={
                                publicationProviderConfiguration?.configured
                                  ? `已保存 ${publicationProviderConfiguration.apiKeyHint}，输入新 Key 将完成轮换`
                                  : "完整 Key 仅在本次提交时传输，不会再次回显"
                              }
                              htmlFor="admin-frog-api-key"
                              label="媒体发布 API Key（必填）"
                              name="apiKey"
                              rules={[
                                { required: true, message: "请输入 API Key" },
                                { max: 2048, message: "API Key 过长" },
                              ]}
                            >
                              <Input.Password
                                autoComplete="new-password"
                                id="admin-frog-api-key"
                                placeholder="输入 API Key"
                              />
                            </Form.Item>
                            <Button
                              htmlType="submit"
                              icon={<KeyOutlined />}
                              loading={busy === "frog-configuration"}
                              type="primary"
                            >
                              验证并保存配置
                            </Button>
                          </Form>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                  <Col xl={8} xs={24}>
                    <Card
                      className="admin-platform-panel admin-publication-provider-card"
                      extra={
                        <Tag
                          color={
                            publicationProviderBalance?.available
                              ? "success"
                              : publicationProviderBalance?.configured
                                ? "warning"
                                : "default"
                          }
                        >
                          {publicationProviderBalance?.available
                            ? "连接正常"
                            : publicationProviderBalance?.configured
                              ? "查询异常"
                              : "未配置"}
                        </Tag>
                      }
                      title="媒体发布平台账户"
                    >
                      <div className="admin-publication-provider-stats">
                        <div>
                          <Statistic
                            formatter={() =>
                              publicationProviderBalance?.moneyAmount ===
                                null ||
                              publicationProviderBalance?.moneyAmount ===
                                undefined
                                ? "—"
                                : money(publicationProviderBalance.moneyAmount)
                            }
                            prefix={<DollarOutlined />}
                            title="上游发布余额"
                            value={publicationProviderBalance?.moneyAmount ?? 0}
                          />
                        </div>
                        <div>
                          <Statistic
                            prefix={<ApiOutlined />}
                            title="剩余接口算力"
                            value={
                              publicationProviderBalance?.powerCount ?? "—"
                            }
                          />
                        </div>
                        <div>
                          <Statistic
                            title="最近核对"
                            value={
                              publicationProviderBalance?.checkedAt
                                ? new Date(
                                    publicationProviderBalance.checkedAt,
                                  ).toLocaleString()
                                : "—"
                            }
                          />
                        </div>
                      </div>
                      <Alert
                        message={
                          publicationProviderBalance?.message ??
                          "正在读取媒体发布账户余额"
                        }
                        showIcon
                        style={{ marginTop: 16 }}
                        type={
                          publicationProviderBalance?.available
                            ? "success"
                            : publicationProviderBalance?.configured
                              ? "warning"
                              : "info"
                        }
                      />
                    </Card>
                  </Col>
                </Row>
              ) : null}

              {tab === "publication-orders" ? (
                <Row gutter={[16, 16]}>
                  <Col xs={24}>{renderPublicationWorkflow()}</Col>
                  <Col xs={24}>
                    <AdminPublicationOrders
                      organizations={meteringOrganizations}
                      refreshVersion={publicationOrderRefresh}
                    />
                  </Col>
                </Row>
              ) : null}

              {tab === "publication-channels" ? (
                <Row gutter={[16, 16]}>
                  <Col xs={24}>{renderPublicationWorkflow()}</Col>
                  <Col xs={24}>
                    <Card
                      className="admin-platform-panel"
                      extra={
                        <Space size={8}>
                          <Tag color="blue">分页加载</Tag>
                          <Typography.Text type="secondary">
                            共 {channelTotal.toLocaleString()} 个渠道
                          </Typography.Text>
                        </Space>
                      }
                      title="发布渠道与人民币价格"
                    >
                      <Alert
                        message="上游目录只提供采购成本和接单状态；平台负责筛选、设置四级售价和决定是否对客户上架。上游下架或平台下架的渠道都不会出现在客户投稿页面。"
                        showIcon
                        style={{ marginBottom: 16 }}
                        type="info"
                      />
                      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                        <Col lg={7} md={12} xs={24}>
                          <Input.Search
                            allowClear
                            enterButton="搜索"
                            onSearch={(value) => {
                              channelPageRef.current = 1;
                              setChannelPage(1);
                              setChannelQuery(value.trim());
                            }}
                            placeholder="搜索媒体名称、分类、备注或行业属性"
                          />
                        </Col>
                        <Col lg={4} md={6} xs={12}>
                          <Select
                            onChange={(value) => {
                              channelPageRef.current = 1;
                              setChannelPage(1);
                              setChannelProvider(value);
                            }}
                            options={[
                              { label: "全部来源", value: "all" },
                              { label: "媒体发布", value: "frog_media" },
                              { label: "人工渠道", value: "manual" },
                            ]}
                            style={{ width: "100%" }}
                            value={channelProvider}
                          />
                        </Col>
                        <Col lg={4} md={6} xs={12}>
                          <Select
                            onChange={(value) => {
                              channelPageRef.current = 1;
                              setChannelPage(1);
                              setChannelMediaType(value);
                            }}
                            options={[
                              { label: "全部媒体", value: "all" },
                              { label: "网站媒体", value: "website" },
                              { label: "自媒体", value: "wemedia" },
                              { label: "人工渠道", value: "manual" },
                            ]}
                            style={{ width: "100%" }}
                            value={channelMediaType}
                          />
                        </Col>
                        <Col lg={4} md={6} xs={12}>
                          <Select
                            onChange={(value) => {
                              channelPageRef.current = 1;
                              setChannelPage(1);
                              setChannelStatus(value);
                            }}
                            options={[
                              { label: "全部状态", value: "all" },
                              { label: "平台启用", value: "active" },
                              { label: "平台下架", value: "inactive" },
                            ]}
                            style={{ width: "100%" }}
                            value={channelStatus}
                          />
                        </Col>
                        <Col lg={5} md={6} xs={12}>
                          <Select
                            onChange={(value) => {
                              channelPageRef.current = 1;
                              setChannelPage(1);
                              setChannelSort(value);
                            }}
                            options={[
                              { label: "分类推荐排序", value: "recommended" },
                              { label: "普通售价从低到高", value: "priceAsc" },
                              { label: "出稿率从高到低", value: "rateDesc" },
                              { label: "出稿速度从快到慢", value: "speedAsc" },
                            ]}
                            style={{ width: "100%" }}
                            value={channelSort}
                          />
                        </Col>
                      </Row>
                      <Table<Channel>
                        columns={channelColumns}
                        dataSource={channels}
                        loading={channelLoading}
                        onChange={(pagination) => {
                          const nextPage = pagination.current ?? 1;
                          const nextPageSize = pagination.pageSize ?? 20;
                          channelPageRef.current = nextPage;
                          channelPageSizeRef.current = nextPageSize;
                          setChannelPage(nextPage);
                          setChannelPageSize(nextPageSize);
                          void loadPublicationChannels(
                            nextPage,
                            nextPageSize,
                          ).catch((error) =>
                            setMessage(
                              error instanceof Error
                                ? error.message
                                : "发布渠道加载失败",
                            ),
                          );
                        }}
                        pagination={{
                          current: channelPage,
                          hideOnSinglePage: true,
                          pageSize: channelPageSize,
                          pageSizeOptions: [20, 50, 100],
                          showSizeChanger: true,
                          showTotal: (currentTotal) =>
                            `共 ${currentTotal.toLocaleString()} 个渠道`,
                          total: channelTotal,
                        }}
                        rowKey="id"
                        onHeaderRow={focusableTableHeaderRow}
                        scroll={{ x: 1170 }}
                      />
                    </Card>
                  </Col>
                  <Col xs={24}>
                    <Card
                      className="admin-platform-panel"
                      extra={
                        <Typography.Text type="secondary">
                          用于线下人工履约
                        </Typography.Text>
                      }
                      title="新增人工发布渠道"
                    >
                      <Form<ChannelForm>
                        form={channelForm}
                        layout="vertical"
                        onFinish={(values) => void createChannel(values)}
                      >
                        <Row gutter={12}>
                          <Col sm={8} xs={24}>
                            <Form.Item
                              label="渠道名称"
                              name="name"
                              rules={[{ required: true }]}
                            >
                              <Input />
                            </Form.Item>
                          </Col>
                          <Col sm={8} xs={24}>
                            <Form.Item
                              label="渠道类型"
                              name="category"
                              rules={[{ required: true }]}
                            >
                              <Input />
                            </Form.Item>
                          </Col>
                          <Col sm={8} xs={24}>
                            <Form.Item
                              label="价格（元）"
                              name="price"
                              rules={[{ required: true }]}
                            >
                              <InputNumber
                                min={0}
                                precision={2}
                                style={{ width: "100%" }}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Button
                          htmlType="submit"
                          loading={busy === "channel"}
                          type="primary"
                        >
                          新增渠道
                        </Button>
                      </Form>
                    </Card>
                  </Col>
                </Row>
              ) : null}

              {tab === "operations" ? (
                <Row gutter={[16, 16]}>
                  <Col xs={24}>
                    <Card
                      extra={
                        <Badge
                          status={
                            !overview
                              ? "processing"
                              : runtimeHealthy
                                ? "success"
                                : "error"
                          }
                          text={
                            !overview
                              ? "检查中"
                              : runtimeHealthy
                                ? "运行正常"
                                : "需要处理"
                          }
                        />
                      }
                      title="异步运行健康"
                    >
                      <Row gutter={[12, 16]}>
                        <Col sm={12} xl={5} xs={24}>
                          <Statistic
                            suffix="个"
                            title="在线 Worker"
                            value={overview?.liveWorkerInstances ?? 0}
                          />
                        </Col>
                        <Col sm={12} xl={5} xs={24}>
                          <Statistic
                            suffix={`/ ${runtimeTasks.length}`}
                            title="正常周期任务"
                            value={overview?.healthyRuntimeTasks ?? 0}
                          />
                        </Col>
                        <Col sm={12} xl={5} xs={24}>
                          <Statistic
                            suffix="个"
                            title="处理中异步作业"
                            value={
                              (overview?.queuedArticleJobs ?? 0) +
                              (overview?.runningArticleJobs ?? 0) +
                              (overview?.queuedReportJobs ?? 0) +
                              (overview?.runningReportJobs ?? 0)
                            }
                            valueStyle={
                              asyncJobsHealthy
                                ? undefined
                                : { color: token.colorError }
                            }
                          />
                        </Col>
                        <Col sm={12} xl={5} xs={24}>
                          <Statistic
                            suffix="条"
                            title="启用检测规则"
                            value={overview?.enabledNotificationRules ?? 0}
                          />
                        </Col>
                        <Col sm={12} xl={4} xs={24}>
                          <Statistic
                            suffix="%"
                            title="AnswerBit 24 小时失败率"
                            value={overview?.answerbitFailureRate24h ?? 0}
                          />
                        </Col>
                      </Row>
                      <Typography.Paragraph
                        style={{ marginBottom: 12, marginTop: 16 }}
                        type="secondary"
                      >
                        最近 Worker 心跳：
                        {overview?.lastWorkerHeartbeatAt
                          ? new Date(
                              overview.lastWorkerHeartbeatAt,
                            ).toLocaleString()
                          : "尚无心跳"}
                        ；异步作业：文章待处理{" "}
                        {overview?.queuedArticleJobs ?? 0}、执行中{" "}
                        {overview?.runningArticleJobs ?? 0}、异常{" "}
                        {overview?.staleArticleJobs ?? 0}；报表待处理{" "}
                        {overview?.queuedReportJobs ?? 0}、执行中{" "}
                        {overview?.runningReportJobs ?? 0}、异常{" "}
                        {overview?.staleReportJobs ?? 0}。
                      </Typography.Paragraph>
                      <Row gutter={[12, 12]}>
                        {runtimeTasks.map((task) => {
                          const status = runtimeTaskStatusMeta[task.status];
                          return (
                            <Col key={task.taskName} lg={6} sm={12} xs={24}>
                              <Card
                                extra={
                                  <Tag color={status.color}>{status.label}</Tag>
                                }
                                size="small"
                                title={task.label}
                              >
                                <Descriptions column={1} size="small">
                                  <Descriptions.Item label="最近成功">
                                    {task.lastSucceededAt
                                      ? new Date(
                                          task.lastSucceededAt,
                                        ).toLocaleString()
                                      : "尚无成功记录"}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="最近耗时">
                                    {task.lastDurationMs === null
                                      ? "—"
                                      : `${task.lastDurationMs}ms`}
                                  </Descriptions.Item>
                                  <Descriptions.Item label="错误码">
                                    {task.lastErrorCode ?? "—"}
                                  </Descriptions.Item>
                                </Descriptions>
                              </Card>
                            </Col>
                          );
                        })}
                      </Row>
                      {!overview || !runtimeHealthy ? (
                        <Alert
                          description={
                            !overview
                              ? "正在读取运行健康数据。"
                              : !workerHealthy
                                ? "Worker 心跳超过 90 秒未更新。请检查 Worker 进程、数据库连接与 pg-boss 消费状态。"
                                : !runtimeTasksHealthy
                                  ? `当前有 ${overview.failedRuntimeTasks ?? 0} 项后台任务失败、${overview.staleRuntimeTasks ?? 0} 项超时、${overview.missingRuntimeTasks ?? 0} 项未上报。请根据任务错误码和 Worker 日志排查。`
                                  : !asyncJobsHealthy
                                    ? `当前有 ${overview.staleAsyncJobs ?? 0} 个异步作业超过恢复阈值。请检查“异步任务恢复”状态、队列任务和错误码。`
                                    : `当前有 ${overview.failedNotificationRules} 条评估失败、${overview.staleNotificationRules} 条超过 30 分钟未评估的持续检测规则。`
                          }
                          message={
                            !overview
                              ? "运行状态检查中"
                              : !workerHealthy
                                ? "Worker 未在线"
                                : !runtimeTasksHealthy
                                  ? "后台周期任务异常"
                                  : !asyncJobsHealthy
                                    ? "异步作业队列异常"
                                    : "持续检测规则异常"
                          }
                          showIcon
                          style={{ marginTop: 16 }}
                          type={!overview ? "info" : "warning"}
                        />
                      ) : null}
                    </Card>
                  </Col>
                  <Col xs={24}>
                    <Card title="操作审计">
                      <Flex gap={10} style={{ marginBottom: 16 }} wrap>
                        <Input.Search
                          allowClear
                          onChange={(event) => {
                            const value = event.target.value;
                            setAuditQueryDraft(value);
                            if (!value && auditQuery) {
                              setAuditPage(1);
                              setAuditQuery("");
                            }
                          }}
                          onSearch={(value) => {
                            setAuditPage(1);
                            setAuditQuery(value.trim());
                          }}
                          placeholder="搜索操作、资源或 Request ID"
                          style={{ flex: "1 1 260px" }}
                          value={auditQueryDraft}
                        />
                        <Select
                          aria-label="筛选审计结果"
                          onChange={(value) => {
                            setAuditPage(1);
                            setAuditStatus(value);
                          }}
                          options={[
                            { label: "全部结果", value: "all" },
                            { label: "成功", value: "success" },
                            { label: "失败", value: "failed" },
                          ]}
                          style={{ width: 120 }}
                          value={auditStatus}
                        />
                        {auditQuery || auditStatus !== "all" ? (
                          <Button
                            onClick={() => {
                              setAuditPage(1);
                              setAuditQueryDraft("");
                              setAuditQuery("");
                              setAuditStatus("all");
                            }}
                            type="text"
                          >
                            重置
                          </Button>
                        ) : null}
                      </Flex>
                      <Table<AuditRow>
                        columns={[
                          {
                            title: "时间",
                            dataIndex: ["log", "createdAt"],
                            width: 180,
                            render: (value: string) =>
                              new Date(value).toLocaleString(),
                          },
                          {
                            title: "操作",
                            dataIndex: ["log", "operation"],
                            width: 240,
                            render: (value: string, item) => (
                              <Space direction="vertical" size={0}>
                                <Typography.Text strong>
                                  {value}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  {item.log.summary ?? item.log.resourceType}
                                </Typography.Text>
                              </Space>
                            ),
                          },
                          {
                            title: "范围",
                            key: "scope",
                            width: 160,
                            render: (_, item) => (
                              <Space direction="vertical" size={0}>
                                <Typography.Text>
                                  {item.actorName}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  {item.organizationName ?? "平台"}
                                </Typography.Text>
                              </Space>
                            ),
                          },
                          {
                            title: "Request ID",
                            dataIndex: ["log", "requestId"],
                            width: 150,
                            render: (value: string) => (
                              <Typography.Text code copyable={{ text: value }}>
                                {value.slice(0, 8)}…
                              </Typography.Text>
                            ),
                          },
                          {
                            title: "结果",
                            dataIndex: ["log", "result"],
                            width: 88,
                            render: (value: string) => (
                              <Tag
                                color={
                                  value === "success" ? "success" : "error"
                                }
                              >
                                {value === "success" ? "成功" : "失败"}
                              </Tag>
                            ),
                          },
                        ]}
                        dataSource={audits}
                        onChange={(pagination) => {
                          setAuditPage(pagination.current ?? 1);
                          setAuditPageSize(pagination.pageSize ?? 20);
                        }}
                        pagination={{
                          current: auditPage,
                          pageSize: auditPageSize,
                          total: auditTotal,
                          showSizeChanger: true,
                          showTotal: (value) => `共 ${value} 条审计记录`,
                        }}
                        rowKey={(item) => item.log.id}
                        onHeaderRow={focusableTableHeaderRow}
                        scroll={{ x: 850 }}
                      />
                    </Card>
                  </Col>
                  <Col xs={24}>
                    <Card title="AnswerBit 接口健康">
                      <Flex gap={10} style={{ marginBottom: 16 }} wrap>
                        <Input.Search
                          allowClear
                          onChange={(event) => {
                            const value = event.target.value;
                            setCallQueryDraft(value);
                            if (!value && callQuery) {
                              setCallPage(1);
                              setCallQuery("");
                            }
                          }}
                          onSearch={(value) => {
                            setCallPage(1);
                            setCallQuery(value.trim());
                          }}
                          placeholder="搜索接口、企业、用户或错误码"
                          style={{ flex: "1 1 260px" }}
                          value={callQueryDraft}
                        />
                        <Select
                          aria-label="筛选调用状态"
                          onChange={(value) => {
                            setCallPage(1);
                            setCallStatus(value);
                          }}
                          options={[
                            { label: "全部状态", value: "all" },
                            { label: "成功", value: "success" },
                            { label: "失败", value: "failed" },
                            { label: "超时", value: "timeout" },
                          ]}
                          style={{ width: 120 }}
                          value={callStatus}
                        />
                        {callQuery || callStatus !== "all" ? (
                          <Button
                            onClick={() => {
                              setCallPage(1);
                              setCallQueryDraft("");
                              setCallQuery("");
                              setCallStatus("all");
                            }}
                            type="text"
                          >
                            重置
                          </Button>
                        ) : null}
                      </Flex>
                      <Table<CallRow>
                        columns={[
                          {
                            title: "时间",
                            dataIndex: ["call", "createdAt"],
                            width: 180,
                            render: (value: string) =>
                              new Date(value).toLocaleString(),
                          },
                          {
                            title: "接口",
                            dataIndex: ["call", "operation"],
                            width: 230,
                            render: (value: string, item) => (
                              <Space direction="vertical" size={0}>
                                <Typography.Text strong>
                                  {value}
                                </Typography.Text>
                                <Typography.Text
                                  code
                                  copyable={{ text: item.call.requestId }}
                                >
                                  {item.call.requestId.slice(0, 8)}…
                                </Typography.Text>
                              </Space>
                            ),
                          },
                          {
                            title: "范围",
                            key: "scope",
                            width: 180,
                            render: (_, item) => (
                              <Space direction="vertical" size={0}>
                                <Typography.Text>
                                  {item.organizationName}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  {item.actorName
                                    ? `${item.actorName} (${item.actorUsername})`
                                    : "系统任务"}
                                </Typography.Text>
                              </Space>
                            ),
                          },
                          {
                            title: "响应",
                            key: "response",
                            width: 150,
                            render: (_, item) => (
                              <Space direction="vertical" size={0}>
                                <Typography.Text>
                                  HTTP {item.call.httpStatus ?? "—"}
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                  {item.call.errorCode ?? "无错误码"}
                                </Typography.Text>
                              </Space>
                            ),
                          },
                          {
                            title: "耗时",
                            dataIndex: ["call", "durationMs"],
                            width: 90,
                            render: (value: number) => value + "ms",
                          },
                          {
                            title: "状态",
                            dataIndex: ["call", "status"],
                            width: 100,
                            render: (value: string) => (
                              <Tag
                                color={
                                  value === "success" ? "success" : "error"
                                }
                              >
                                {value === "success"
                                  ? "成功"
                                  : value === "timeout"
                                    ? "超时"
                                    : "失败"}
                              </Tag>
                            ),
                          },
                        ]}
                        dataSource={calls}
                        onChange={(pagination) => {
                          setCallPage(pagination.current ?? 1);
                          setCallPageSize(pagination.pageSize ?? 20);
                        }}
                        pagination={{
                          current: callPage,
                          pageSize: callPageSize,
                          total: callTotal,
                          showSizeChanger: true,
                          showTotal: (value) => `共 ${value} 条调用记录`,
                        }}
                        rowKey={(item) => item.call.id}
                        onHeaderRow={focusableTableHeaderRow}
                        scroll={{ x: 1000 }}
                      />
                    </Card>
                  </Col>
                </Row>
              ) : null}
            </Flex>
          </div>
        </Layout.Content>
      </Layout>

      <Drawer
        onClose={() => setMobileMenuOpen(false)}
        open={!desktopNavigation && mobileMenuOpen}
        placement="left"
        rootClassName="admin-platform-mobile-drawer"
        styles={{ body: { padding: 12 } }}
        title={null}
        width={292}
      >
        {sidebar}
      </Drawer>

      <Modal
        footer={null}
        onCancel={() => {
          setPlatformBrandCreateOpen(false);
          platformBrandForm.resetFields();
        }}
        open={platformBrandCreateOpen}
        title="新建腾讯企业"
        width={760}
      >
        <Alert
          description="普通创建调用 /geo/brand/create；填写初始化问题或竞品后调用 /geo/brand/bundle/create。腾讯返回真实 BrandID 后自动创建平台企业。"
          message="腾讯上游写入并创建平台企业"
          showIcon
          style={{ marginBottom: 20 }}
          type="info"
        />
        <Form<PlatformBrandForm>
          form={platformBrandForm}
          layout="vertical"
          onFinish={(values) => void createPlatformAnswerbitBrand(values)}
          size="large"
        >
          <Form.Item
            label="品牌名称"
            name="brand"
            rules={[{ required: true, message: "请输入品牌名称" }]}
          >
            <Input maxLength={255} placeholder="腾讯 AnswerBit 中的品牌名称" />
          </Form.Item>
          <Form.Item label="品牌别名" name="alias">
            <Input maxLength={255} placeholder="可选" />
          </Form.Item>
          <Form.Item
            label="官方网站"
            name="website"
            rules={[{ type: "url", message: "请输入完整 URL" }]}
          >
            <Input maxLength={2048} placeholder="https://example.com" />
          </Form.Item>
          <Form.Item label="品牌描述" name="description">
            <Input.TextArea maxLength={5000} rows={3} />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea maxLength={2000} rows={2} />
          </Form.Item>
          <Form.Item
            extra="每行一个问题；填写后使用腾讯批量初始化接口创建品牌。"
            label="初始化监测问题"
            name="initialPrompts"
          >
            <Input.TextArea
              maxLength={20_000}
              placeholder={"这个品牌值得买吗？\n这个品牌适合哪些场景？"}
              rows={4}
            />
          </Form.Item>
          <Form.Item
            extra="每行一个竞品名称；可在企业工作台继续完善别名和资料。"
            label="初始化竞品"
            name="competitors"
          >
            <Input.TextArea
              maxLength={10_000}
              placeholder={"竞品 A\n竞品 B"}
              rows={3}
            />
          </Form.Item>
          <Button
            block
            htmlType="submit"
            loading={busy === "platform-answerbit-brand-create"}
            type="primary"
          >
            调用腾讯接口并创建
          </Button>
        </Form>
      </Modal>

      <Modal
        cancelText="取消"
        destroyOnHidden
        okButtonProps={{
          disabled: !platformBrandIcon || Boolean(platformBrandIconError),
          loading:
            busy ===
            `platform-answerbit-brand-icon-${editingPlatformBrandIcon?.brandId}`,
        }}
        okText="上传并更新"
        onCancel={() => {
          setEditingPlatformBrandIcon(null);
          setPlatformBrandIcon(null);
          setPlatformBrandIconError("");
        }}
        onOk={() => void updatePlatformAnswerbitBrandIcon()}
        open={Boolean(editingPlatformBrandIcon)}
        title={`更新 ${editingPlatformBrandIcon?.brandName ?? "腾讯企业"} Logo`}
        width={680}
      >
        <Flex gap={16} vertical>
          <Alert
            description="建议使用清晰的正方形图片；上传后将立即同步到腾讯 AnswerBit，原 Logo 会被替换。"
            message="品牌识别图"
            showIcon
            type="info"
          />
          <Upload.Dragger
            accept={brandIconAccept}
            beforeUpload={(file) => {
              const validationError = brandIconValidationError(file);
              if (validationError) {
                setPlatformBrandIcon(null);
                setPlatformBrandIconError(validationError);
                return Upload.LIST_IGNORE;
              }
              setPlatformBrandIcon(file);
              setPlatformBrandIconError("");
              return false;
            }}
            fileList={[]}
            key={editingPlatformBrandIcon?.brandId}
            maxCount={1}
            multiple={false}
            openFileDialogOnClick
            showUploadList={false}
          >
            <Flex align="center" gap={12} justify="center" vertical>
              <InboxOutlined
                style={{ color: token.colorPrimary, fontSize: 32 }}
              />
              <Flex align="center" gap={4} vertical>
                <Typography.Text strong>
                  拖拽图片到此处，或点击选择
                </Typography.Text>
                <Typography.Text type="secondary">
                  JPG、PNG、GIF、WebP、SVG · 最大 2MB
                </Typography.Text>
              </Flex>
            </Flex>
          </Upload.Dragger>
          {platformBrandIconError ? (
            <Alert message={platformBrandIconError} showIcon type="error" />
          ) : null}
          {platformBrandIcon ? (
            <Card size="small">
              <Flex align="center" gap={12} justify="space-between">
                <Flex align="center" gap={12} style={{ minWidth: 0 }}>
                  <Avatar
                    icon={<PictureOutlined />}
                    shape="square"
                    size={44}
                    style={{ background: token.colorPrimaryBg }}
                  />
                  <Flex style={{ minWidth: 0 }} vertical>
                    <Typography.Text ellipsis strong>
                      {platformBrandIcon.name}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {brandIconMimeType(platformBrandIcon)
                        .replace("image/", "")
                        .toUpperCase()}{" "}
                      ·{" "}
                      {platformBrandIcon.size < 1024
                        ? `${platformBrandIcon.size} B`
                        : `${Math.ceil(platformBrandIcon.size / 1024)} KB`}
                    </Typography.Text>
                  </Flex>
                </Flex>
                <Button
                  aria-label={`移除图片 ${platformBrandIcon.name}`}
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setPlatformBrandIcon(null);
                    setPlatformBrandIconError("");
                  }}
                  type="text"
                >
                  移除
                </Button>
              </Flex>
            </Card>
          ) : null}
          <Typography.Text type="secondary">
            文件只会在点击“上传并更新”后提交；取消不会修改当前 Logo。
          </Typography.Text>
        </Flex>
      </Modal>

      <Modal
        footer={null}
        onCancel={() => {
          setEditingPlatformBrand(null);
          platformBrandUpdateForm.resetFields();
        }}
        open={Boolean(editingPlatformBrand)}
        title="修改腾讯企业"
        width={760}
      >
        <Alert
          description="提交后会先调用腾讯 /geo/brand/update；只有腾讯修改成功，系统才会更新品牌目录和平台企业名称。"
          message="以腾讯上游结果为准"
          showIcon
          style={{ marginBottom: 20 }}
          type="info"
        />
        <Form<PlatformBrandUpdateForm>
          form={platformBrandUpdateForm}
          layout="vertical"
          onFinish={(values) => void updatePlatformAnswerbitBrand(values)}
          size="large"
        >
          <Form.Item
            label="品牌名称"
            name="brandName"
            rules={[{ required: true, message: "请输入品牌名称" }]}
          >
            <Input maxLength={255} placeholder="腾讯 AnswerBit 中的品牌名称" />
          </Form.Item>
          <Form.Item label="品牌别名" name="brandAlias">
            <Input maxLength={255} placeholder="可选" />
          </Form.Item>
          <Form.Item
            label="官方网站"
            name="website"
            rules={[{ type: "url", message: "请输入完整 URL" }]}
          >
            <Input maxLength={2048} placeholder="https://example.com" />
          </Form.Item>
          <Form.Item label="品牌描述" name="description">
            <Input.TextArea maxLength={5000} rows={3} />
          </Form.Item>
          <Form.Item label="备注" name="note">
            <Input.TextArea maxLength={2000} rows={2} />
          </Form.Item>
          <Form.Item
            label="官网自动追踪"
            name="websiteAutoTrace"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Button
            block
            htmlType="submit"
            loading={
              busy ===
              `platform-answerbit-brand-update-${editingPlatformBrand?.brandId}`
            }
            type="primary"
          >
            调用腾讯接口并保存
          </Button>
        </Form>
      </Modal>

      <Modal
        centered
        destroyOnHidden
        okButtonProps={{ loading: busy === "user" }}
        okText="创建账户"
        onCancel={() => {
          setUserCreateOpen(false);
          userForm.resetFields();
          setSelectedNewAccountType("customer");
          setSelectedNewAgentValidityMode("permanent");
        }}
        onOk={() => userForm.submit()}
        open={userCreateOpen}
        title="创建平台账户"
        width={720}
      >
        <Form<UserForm>
          form={userForm}
          initialValues={{
            accountType: "customer",
            agentValidityMode: "permanent",
            pricingTier: "bronze",
          }}
          layout="vertical"
          onFinish={(values) => void createUser(values)}
          preserve={false}
          size="large"
        >
          <Row gutter={16}>
            <Col sm={12} xs={24}>
              <Form.Item
                label="用户名称"
                name="name"
                rules={[
                  { required: true, message: "请输入用户名称" },
                  { min: 2, max: 80, message: "请输入 2–80 个字符" },
                ]}
              >
                <Input autoComplete="name" placeholder="例如：张小明" />
              </Form.Item>
            </Col>
            <Col sm={12} xs={24}>
              <Form.Item
                label="账户类型"
                name="accountType"
                rules={[{ required: true, message: "请选择账户类型" }]}
              >
                <Select
                  onChange={(value: User["accountType"]) => {
                    setSelectedNewAccountType(value);
                    if (value === "agent")
                      userForm.setFieldValue(
                        "pricingTier",
                        userForm.getFieldValue("pricingTier") ?? "bronze",
                      );
                    if (value === "agent")
                      userForm.setFieldValue(
                        "agentValidityMode",
                        userForm.getFieldValue("agentValidityMode") ??
                          "permanent",
                      );
                  }}
                  options={[
                    {
                      label: "管理员 · 管理平台全局资源",
                      value: "admin",
                    },
                    {
                      label: "代理商 · 可负责多个企业",
                      value: "agent",
                    },
                    {
                      label: "客户 · 使用企业与品牌能力",
                      value: "customer",
                    },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          {selectedNewAccountType === "agent" ? (
            <Card
              size="small"
              style={{ marginBottom: 20 }}
              title="代理价格等级"
            >
              <Form.Item
                extra="决定发布渠道售价和业务功能积分扣减系数，可在用户设置中随时调整。"
                name="pricingTier"
                rules={[{ required: true, message: "请选择代理价格等级" }]}
                style={{ marginBottom: 0 }}
              >
                <Radio.Group
                  optionType="button"
                  options={pricingTiers
                    .filter((tier) => tier !== "retail")
                    .map((tier) => ({
                      label: pricingTierMeta[tier].label,
                      value: tier,
                    }))}
                />
              </Form.Item>
            </Card>
          ) : null}
          {selectedNewAccountType === "agent" ? (
            <Card
              size="small"
              style={{ marginBottom: 20 }}
              title="代理商有效期"
            >
              <Form.Item name="agentValidityMode" style={{ marginBottom: 12 }}>
                <Radio.Group
                  onChange={(event) => {
                    setSelectedNewAgentValidityMode(event.target.value);
                    if (
                      event.target.value === "range" &&
                      !userForm.getFieldValue("agentValidityRange")
                    )
                      userForm.setFieldValue("agentValidityRange", [
                        dayjs(),
                        dayjs().add(1, "year"),
                      ]);
                  }}
                  options={[
                    { label: "长期有效", value: "permanent" },
                    { label: "指定时间范围", value: "range" },
                  ]}
                />
              </Form.Item>
              {selectedNewAgentValidityMode === "range" ? (
                <Form.Item
                  extra="到达开始时间后自动开放访问，到期后自动停止登录和 API 访问。"
                  name="agentValidityRange"
                  rules={[
                    { required: true, message: "请选择代理商有效时间范围" },
                  ]}
                  style={{ marginBottom: 0 }}
                >
                  <DatePicker.RangePicker
                    allowClear={false}
                    showTime
                    style={{ width: "100%" }}
                  />
                </Form.Item>
              ) : (
                <Typography.Text type="secondary">
                  长期有效的代理商将持续拥有登录资格，仍可随时停用账户。
                </Typography.Text>
              )}
            </Card>
          ) : null}
          <Form.Item
            extra="3–32 位，以小写字母开头，仅支持小写字母、数字和下划线。"
            label="登录账号"
            name="username"
            rules={[
              { required: true, message: "请输入登录账号" },
              {
                pattern: /^[a-z][a-z0-9_]{2,31}$/,
                message: "账号格式不正确",
              },
            ]}
          >
            <Input autoComplete="username" placeholder="例如：zhang_xiaoming" />
          </Form.Item>
          <Form.Item
            extra="12–128 位，必须同时包含字母和数字，可搭配符号。"
            label="初始密码"
            name="password"
            rules={[
              { required: true, message: "请输入初始密码" },
              { min: 12, max: 128, message: "密码需为 12–128 位" },
              {
                pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
                message: "密码必须同时包含字母和数字",
              },
            ]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder="输入至少 12 位的初始密码"
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        centered
        destroyOnHidden
        okButtonProps={{ loading: busy === "user-access" }}
        okText="保存设置"
        onCancel={() => {
          setEditingUserAccess(null);
          userAccessForm.resetFields();
          setSelectedAccessAccountType("customer");
          setSelectedAccessValidityMode("permanent");
        }}
        onOk={() => userAccessForm.submit()}
        open={Boolean(editingUserAccess)}
        title={
          editingUserAccess
            ? `账户权限与额度 · ${editingUserAccess.user.name}`
            : "账户权限与额度"
        }
        styles={{ body: { maxHeight: "72vh", overflowY: "auto" } }}
        width={1080}
      >
        {editingUserAccess ? (
          <>
            {editingUserAccess.user.accountType === "customer" &&
            editingUserAccess.brandAccess.length > 0 ? (
              <Alert
                description="关闭此窗口，在用户档案的企业成员关系中移出原品牌企业，再重新打开账户设置切换为代理商。"
                message="当前用户仍有品牌级权限，暂不能切换为代理商"
                showIcon
                style={{ marginBottom: 20 }}
                type="warning"
              />
            ) : editingUserAccess.user.accountType === "agent" &&
              editingUserAccess.memberships.some(
                (membership) => membership.role === "tenant_admin",
              ) ? (
              <Alert
                description="请先为相关企业转移管理员职责并移除该用户的企业管理员角色。"
                message="当前代理商仍是企业管理员，暂不能切换为客户"
                showIcon
                style={{ marginBottom: 20 }}
                type="warning"
              />
            ) : null}
            <Form<UserAccessForm>
              form={userAccessForm}
              layout="vertical"
              onFinish={(values) => void saveUserAccess(values)}
              preserve={false}
              size="large"
            >
              {userAccessError ? (
                <Alert
                  type="error"
                  showIcon
                  message="账户设置未保存"
                  description={userAccessError}
                  style={{ marginBottom: 16 }}
                />
              ) : null}
              <Form.Item
                label="账户类型"
                name="accountType"
                rules={[{ required: true, message: "请选择账户类型" }]}
              >
                <Radio.Group
                  onChange={(event) => {
                    setSelectedAccessAccountType(event.target.value);
                    if (event.target.value === "agent") {
                      userAccessForm.setFieldValue(
                        "pricingTier",
                        editingUserAccess.user.accountType === "agent"
                          ? editingUserAccess.user.pricingTier
                          : "bronze",
                      );
                      userAccessForm.setFieldValue(
                        "agentValidityMode",
                        userAccessForm.getFieldValue("agentValidityMode") ??
                          "permanent",
                      );
                    } else
                      userAccessForm.setFieldValue("pricingTier", "retail");
                  }}
                  optionType="button"
                  options={[
                    {
                      disabled: editingUserAccess.memberships.some(
                        (membership) => membership.role === "tenant_admin",
                      ),
                      label: "客户用户",
                      value: "customer",
                    },
                    {
                      disabled: editingUserAccess.brandAccess.length > 0,
                      label: "代理商",
                      value: "agent",
                    },
                  ]}
                />
              </Form.Item>

              <Card
                extra={
                  <Typography.Text type="secondary">
                    发布售价与积分扣减均按此等级执行
                  </Typography.Text>
                }
                size="small"
                style={{ marginBottom: 16 }}
                title="价格等级"
              >
                <Form.Item name="pricingTier" style={{ marginBottom: 0 }}>
                  <Radio.Group
                    disabled={selectedAccessAccountType !== "agent"}
                    optionType="button"
                    options={pricingTiers.map((tier) => ({
                      label: pricingTierMeta[tier].label,
                      value: tier,
                      disabled:
                        selectedAccessAccountType === "agent" &&
                        tier === "retail",
                    }))}
                  />
                </Form.Item>
              </Card>

              {selectedAccessAccountType === "agent" ? (
                <Card
                  size="small"
                  style={{ marginBottom: 16 }}
                  title="代理商有效时间"
                >
                  <Form.Item
                    name="agentValidityMode"
                    style={{ marginBottom: 12 }}
                  >
                    <Radio.Group
                      onChange={(event) => {
                        setSelectedAccessValidityMode(event.target.value);
                        if (
                          event.target.value === "range" &&
                          !userAccessForm.getFieldValue("agentValidityRange")
                        )
                          userAccessForm.setFieldValue("agentValidityRange", [
                            dayjs(),
                            dayjs().add(1, "year"),
                          ]);
                      }}
                      options={[
                        { label: "长期有效", value: "permanent" },
                        { label: "指定时间范围", value: "range" },
                      ]}
                    />
                  </Form.Item>
                  {selectedAccessValidityMode === "range" ? (
                    <Form.Item
                      extra="生效前与到期后的代理商登录和 API 请求都会被拦截。"
                      name="agentValidityRange"
                      rules={[
                        {
                          required: true,
                          message: "请选择代理商有效时间范围",
                        },
                      ]}
                      style={{ marginBottom: 0 }}
                    >
                      <DatePicker.RangePicker
                        allowClear={false}
                        showTime
                        style={{ width: "100%" }}
                      />
                    </Form.Item>
                  ) : (
                    <Typography.Text type="secondary">
                      长期有效；仍可通过停用账户立即撤销访问。
                    </Typography.Text>
                  )}
                </Card>
              ) : null}

              {selectedAccessAccountType === "agent" ? (
                <Card
                  extra={
                    <Typography.Text type="secondary">
                      留空表示不限制，0 表示禁止
                    </Typography.Text>
                  }
                  size="small"
                  style={{ marginBottom: 16 }}
                  title="代理商经营额度"
                >
                  <Row gutter={12}>
                    <Col md={8} xs={24}>
                      <Form.Item
                        extra={`当前管理 ${editingUserAccess.agentQuotaUsage.enterpriseCount} 家企业`}
                        label="企业额度"
                        name="enterpriseLimit"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          min={0}
                          placeholder="不限制"
                          precision={0}
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col md={8} xs={24}>
                      <Form.Item
                        extra={`已创建 ${editingUserAccess.agentQuotaUsage.brandCount} 个品牌`}
                        label="品牌创建额度"
                        name="brandLimit"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          min={0}
                          placeholder="不限制"
                          precision={0}
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                    <Col md={8} xs={24}>
                      <Form.Item
                        extra={`已划拨 ${editingUserAccess.agentQuotaUsage.answerbitPoints.toLocaleString()} 积分`}
                        label="腾讯积分额度"
                        name="answerbitPointsLimit"
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          min={0}
                          placeholder="不限制"
                          precision={0}
                          style={{ width: "100%" }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              ) : null}

              <Card size="small" title="目标企业功能授权">
                {[
                  ...new Map(
                    editingUserAccess.memberships.map((membership) => [
                      membership.organizationId,
                      membership,
                    ]),
                  ).values(),
                ].length ? (
                  [
                    ...new Map(
                      editingUserAccess.memberships.map((membership) => [
                        membership.organizationId,
                        membership,
                      ]),
                    ).values(),
                  ].map((membership, index) => (
                    <Card
                      key={membership.organizationId}
                      size="small"
                      style={{
                        background: token.colorFillAlter,
                        marginBottom: 12,
                      }}
                      title={
                        <Space>
                          <BankOutlined />
                          <span>{membership.organizationName}</span>
                          <Tag>
                            {roleLabels[membership.role ?? ""] ?? "品牌成员"}
                          </Tag>
                        </Space>
                      }
                    >
                      <Form.Item
                        hidden
                        name={[
                          "organizationFeatureScopes",
                          index,
                          "organizationId",
                        ]}
                      >
                        <Input />
                      </Form.Item>
                      <Form.Item
                        name={["organizationFeatureScopes", index, "features"]}
                        style={{ marginBottom: 0 }}
                      >
                        <Checkbox.Group
                          options={organizationFeatureOptions}
                          style={{
                            display: "grid",
                            gap: "10px 16px",
                            gridTemplateColumns: mobile
                              ? "1fr"
                              : "repeat(2, minmax(0, 1fr))",
                            width: "100%",
                          }}
                        />
                      </Form.Item>
                    </Card>
                  ))
                ) : (
                  <Empty
                    description="请先在企业详情中为该用户分配目标企业"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                )}
              </Card>
            </Form>
          </>
        ) : null}
      </Modal>

      <Drawer
        destroyOnHidden
        onClose={() => {
          organizationDetailVersion.current++;
          directoryUserSearchVersion.current++;
          setOrganizationDetail(null);
          memberForm.resetFields();
        }}
        extra={
          <Button
            aria-label="刷新企业详情"
            loading={detailLoading === "organization"}
            onClick={() =>
              organizationDetail &&
              void openOrganization(
                organizationDetail.organization.id,
                true,
              ).catch(() => {})
            }
          >
            刷新
          </Button>
        }
        open={Boolean(organizationDetail)}
        title={
          organizationDetail
            ? `企业详情 · ${organizationDetail.organization.name}`
            : "企业详情"
        }
        width={mobile ? "100%" : 960}
      >
        {organizationDetail ? (
          <Flex gap={20} vertical>
            {organizationReadError ? (
              <Alert
                type="error"
                showIcon
                message="企业详情刷新失败"
                description={organizationReadError}
              />
            ) : null}
            <Button
              onClick={() =>
                setValidityOrganization(organizationDetail.organization)
              }
            >
              设置企业 / 积分有效期
            </Button>
            <Descriptions bordered column={mobile ? 1 : 3} size="small">
              <Descriptions.Item label="企业到期">
                {organizationDetail.organization.serviceExpiresAt
                  ? dayjs(
                      organizationDetail.organization.serviceExpiresAt,
                    ).format("YYYY-MM-DD HH:mm")
                  : "待设置"}
              </Descriptions.Item>
              <Descriptions.Item label="积分到期">
                {organizationDetail.organization.pointsExpiresAt
                  ? dayjs(
                      organizationDetail.organization.pointsExpiresAt,
                    ).format("YYYY-MM-DD HH:mm")
                  : "待设置"}
              </Descriptions.Item>
              <Descriptions.Item label="腾讯企业名称">
                {organizationDetail.organization.name}
              </Descriptions.Item>
              <Descriptions.Item label="内部租户标识">
                {organizationDetail.organization.slug}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Badge
                  status={
                    organizationDetail.organization.status === "active"
                      ? "success"
                      : "warning"
                  }
                  text={organizationDetail.organization.status}
                />
              </Descriptions.Item>
              <Descriptions.Item label="腾讯品牌" span={mobile ? 1 : 3}>
                <Space>
                  <Typography.Text strong>
                    {organizationDetail.organization.answerbitBrandName}
                  </Typography.Text>
                  <Typography.Text code copyable>
                    {organizationDetail.organization.answerbitBrandId}
                  </Typography.Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="企业 ID" span={mobile ? 1 : 2}>
                <Typography.Text copyable>
                  {organizationDetail.organization.id}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {new Date(
                  organizationDetail.organization.createdAt,
                ).toLocaleString()}
              </Descriptions.Item>
            </Descriptions>

            <Row gutter={[12, 12]}>
              <Col sm={8} xs={24}>
                <Card size="small">
                  <Statistic
                    title="企业成员"
                    value={organizationDetail.organization.memberCount}
                  />
                </Card>
              </Col>
              <Col sm={8} xs={24}>
                <Card size="small">
                  <Statistic
                    title="腾讯品牌"
                    value={
                      organizationDetail.organization.answerbitBrandId ? 1 : 0
                    }
                  />
                </Card>
              </Col>
              <Col sm={8} xs={24}>
                <Card size="small">
                  <Statistic
                    title="有效成员"
                    value={
                      organizationDetail.members.filter(
                        (member) =>
                          member.memberStatus === "active" &&
                          member.accountState === "active",
                      ).length
                    }
                  />
                </Card>
              </Col>
            </Row>

            <Card size="small" title="添加成员与权限">
              <Form<MemberForm>
                form={memberForm}
                name="admin-enterprise-member"
                disabled={organizationGrant.busy || organizationGrant.checking}
                initialValues={{ role: "tenant_admin" }}
                layout="vertical"
                onFinish={(values) => void addOrganizationMember(values)}
              >
                {organizationGrant.error ? (
                  <Alert
                    type={organizationGrant.refreshFailed ? "warning" : "error"}
                    showIcon
                    message={
                      organizationGrant.refreshFailed
                        ? "成员权限已保存，目录未刷新"
                        : "成员权限未保存"
                    }
                    description={organizationGrant.error}
                    style={{ marginBottom: 16 }}
                  />
                ) : null}
                <Row gutter={12}>
                  <Col md={12} xs={24}>
                    <Form.Item
                      label="平台用户"
                      name="userId"
                      rules={[{ required: true, message: "请选择用户" }]}
                    >
                      <Select
                        filterOption={false}
                        onSearch={(value) => void searchDirectoryUsers(value)}
                        options={directoryUsers
                          .filter((user) =>
                            selectedMemberRole === "tenant_admin"
                              ? user.accountType !== "customer"
                              : user.accountType !== "agent",
                          )
                          .map((user) => ({
                            label: `${user.name} · @${user.username} · ${user.accountType === "agent" ? "代理商" : user.accountType === "admin" ? "管理员" : "客户"}`,
                            value: user.id,
                          }))}
                        placeholder="选择已有账户；代理商请分配企业管理员角色"
                        showSearch
                      />
                    </Form.Item>
                  </Col>
                  <Col md={12} xs={24}>
                    <Form.Item
                      label="角色"
                      name="role"
                      rules={[{ required: true }]}
                    >
                      <Select
                        onChange={(value: MemberForm["role"]) => {
                          setSelectedMemberRole(value);
                          memberForm.setFieldValue("userId", undefined);
                        }}
                        options={[
                          { label: "企业管理员", value: "tenant_admin" },
                          { label: "品牌管理员", value: "brand_admin" },
                          { label: "品牌编辑", value: "brand_editor" },
                          { label: "品牌查看者", value: "brand_viewer" },
                        ]}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Button
                  aria-label="保存成员权限"
                  htmlType="submit"
                  loading={organizationGrant.busy}
                  type="primary"
                >
                  保存成员权限
                </Button>
                {organizationGrant.checking ? (
                  <Button
                    aria-label="核对操作结果"
                    loading={organizationGrant.busy}
                    disabled={false}
                    onClick={() => void organizationGrant.run()}
                    style={{ marginLeft: 8 }}
                  >
                    核对操作结果
                  </Button>
                ) : null}
              </Form>
            </Card>

            <Card size="small" title="企业成员">
              <Table<OrganizationMember>
                columns={[
                  {
                    title: "用户",
                    dataIndex: "name",
                    render: (value: string, member) => (
                      <Space direction="vertical" size={0}>
                        <Button
                          onClick={() => void openUser(member.userId)}
                          style={{ padding: 0 }}
                          type="link"
                        >
                          {value}
                        </Button>
                        <Typography.Text type="secondary">
                          @{member.username ?? "legacy"}
                        </Typography.Text>
                        {member.accountState !== "active" ? (
                          <Typography.Text type="secondary">
                            {member.accountState === "disabled"
                              ? "账号已停用"
                              : member.accountState === "expired"
                                ? "账号已过期"
                                : "账号未生效"}
                          </Typography.Text>
                        ) : null}
                      </Space>
                    ),
                  },
                  {
                    title: "账户/角色",
                    key: "role",
                    render: (_, member) => (
                      <Space wrap>
                        <Tag>
                          {member.accountType === "agent"
                            ? "代理商"
                            : member.accountType === "admin"
                              ? "管理员"
                              : "客户"}
                        </Tag>
                        <Tag color={member.role ? "blue" : "default"}>
                          {member.role
                            ? (roleLabels[member.role] ?? member.role)
                            : "品牌范围用户"}
                        </Tag>
                      </Space>
                    ),
                  },
                  {
                    title: "成员状态",
                    dataIndex: "memberStatus",
                    width: 110,
                    render: (value: string) => (
                      <Badge
                        status={value === "active" ? "success" : "default"}
                        text={value === "active" ? "正常" : "已停用"}
                      />
                    ),
                  },
                  {
                    title: "操作",
                    key: "action",
                    width: 170,
                    render: (_, member) => (
                      <Space>
                        <AdminMemberActions
                          organization={organizationDetail.organization}
                          member={{
                            id: member.id,
                            name: member.name,
                            username: member.username,
                            status: member.memberStatus,
                          }}
                          onChanged={async () => {
                            await Promise.all([
                              openOrganization(
                                organizationDetail.organization.id,
                                true,
                              ),
                              load(),
                            ]);
                          }}
                        />
                      </Space>
                    ),
                  },
                ]}
                dataSource={organizationDetail.members}
                locale={{ emptyText: <Empty description="暂无企业成员" /> }}
                pagination={false}
                rowKey="id"
                onHeaderRow={focusableTableHeaderRow}
                scroll={{ x: 720 }}
                size="small"
              />
            </Card>
          </Flex>
        ) : null}
      </Drawer>

      <Drawer
        destroyOnHidden
        onClose={() => {
          userDetailVersion.current++;
          setUserDetail(null);
          userOrganizationSearchVersion.current += 1;
          setUserOrganizationOptions([]);
          userOrganizationForm.resetFields();
        }}
        extra={
          <Button
            aria-label="刷新用户档案"
            loading={detailLoading === "user"}
            onClick={() =>
              userDetail &&
              void openUser(userDetail.user.id, true).catch(() => {})
            }
          >
            刷新
          </Button>
        }
        open={Boolean(userDetail)}
        title="用户档案"
        width={mobile ? "100%" : 860}
      >
        {userDetail ? (
          <Flex gap={20} vertical>
            {userReadError ? (
              <Alert
                type="error"
                showIcon
                message="用户档案刷新失败"
                description={userReadError}
              />
            ) : null}
            <Card size="small">
              <Flex align="center" gap={16} justify="space-between" wrap>
                <Space size={16}>
                  <Avatar size={52}>
                    {userDetail.user.name.slice(0, 1).toUpperCase()}
                  </Avatar>
                  <Space direction="vertical" size={2}>
                    <Space wrap>
                      <Typography.Title level={4} style={{ margin: 0 }}>
                        {userDetail.user.name}
                      </Typography.Title>
                      <Badge
                        status={
                          effectiveStatusMeta[
                            effectiveUserStatus(userDetail.user)
                          ].badge
                        }
                        text={
                          effectiveStatusMeta[
                            effectiveUserStatus(userDetail.user)
                          ].label
                        }
                      />
                    </Space>
                    <Typography.Text type="secondary">
                      @{userDetail.user.username ?? "legacy"}
                    </Typography.Text>
                    <Space size={[0, 4]} wrap>
                      <Tag
                        color={
                          accountTypeMeta[userDetail.user.accountType].color
                        }
                      >
                        {accountTypeMeta[userDetail.user.accountType].label}
                      </Tag>
                      <Tag
                        color={
                          pricingTierMeta[userDetail.user.pricingTier].color
                        }
                      >
                        {pricingTierMeta[userDetail.user.pricingTier].label}
                      </Tag>
                      {userDetail.user.platformRole ? (
                        <Tag color="purple">
                          {roleLabels[userDetail.user.platformRole] ??
                            userDetail.user.platformRole}
                        </Tag>
                      ) : null}
                    </Space>
                  </Space>
                </Space>
                <Button
                  icon={<EditOutlined />}
                  onClick={() =>
                    setEditingUserName({
                      id: userDetail.user.id,
                      name: userDetail.user.name,
                    })
                  }
                >
                  修改名称
                </Button>
                {userDetail.user.accountType !== "admin" ? (
                  <Button
                    onClick={() => openUserAccessEditor(userDetail)}
                    type="primary"
                  >
                    {userDetail.user.accountType === "customer"
                      ? "转为代理商 / 编辑账户"
                      : "编辑代理商设置"}
                  </Button>
                ) : null}
              </Flex>
            </Card>

            <Row gutter={[12, 12]}>
              <Col sm={8} xs={24}>
                <Card size="small">
                  <Statistic
                    title="所属企业"
                    value={userDetail.memberships.length}
                  />
                </Card>
              </Col>
              <Col sm={8} xs={24}>
                <Card size="small">
                  <Statistic
                    title="品牌范围企业"
                    value={
                      new Set(
                        userDetail.brandAccess.map(
                          (item) => item.organizationId,
                        ),
                      ).size
                    }
                  />
                </Card>
              </Col>
              <Col sm={8} xs={24}>
                <Card size="small">
                  <Statistic
                    title="品牌权限"
                    value={userDetail.brandAccess.length}
                  />
                </Card>
              </Col>
            </Row>

            <Descriptions
              bordered
              column={mobile ? 1 : 2}
              size="small"
              title="账户资料"
            >
              <Descriptions.Item label="用户 ID" span={mobile ? 1 : 2}>
                <Typography.Text copyable>{userDetail.user.id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {new Date(userDetail.user.createdAt).toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label="最近更新">
                {new Date(userDetail.user.updatedAt).toLocaleString()}
              </Descriptions.Item>
              {userDetail.user.accountType === "agent" ? (
                <>
                  <Descriptions.Item label="代理生效时间">
                    {userDetail.user.agentValidFrom
                      ? new Date(
                          userDetail.user.agentValidFrom,
                        ).toLocaleString()
                      : "立即生效"}
                  </Descriptions.Item>
                  <Descriptions.Item label="代理到期时间">
                    {userDetail.user.agentExpiresAt
                      ? new Date(
                          userDetail.user.agentExpiresAt,
                        ).toLocaleString()
                      : "长期有效"}
                  </Descriptions.Item>
                  <Descriptions.Item label="企业额度">
                    {userDetail.agentQuotaUsage.enterpriseCount.toLocaleString()}
                    {" / "}
                    {userDetail.user.agentEnterpriseLimit?.toLocaleString() ??
                      "不限"}
                  </Descriptions.Item>
                  <Descriptions.Item label="品牌创建额度">
                    {userDetail.agentQuotaUsage.brandCount.toLocaleString()}
                    {" / "}
                    {userDetail.user.agentBrandLimit?.toLocaleString() ??
                      "不限"}
                  </Descriptions.Item>
                  <Descriptions.Item label="腾讯积分额度">
                    {userDetail.agentQuotaUsage.answerbitPoints.toLocaleString()}
                    {" / "}
                    {userDetail.user.agentAnswerbitPointsLimit?.toLocaleString() ??
                      "不限"}
                  </Descriptions.Item>
                </>
              ) : null}
            </Descriptions>

            <Card size="small" title="添加或调整企业权限">
              <Form<UserOrganizationForm>
                form={userOrganizationForm}
                name="admin-user-organization"
                disabled={userGrant.busy || userGrant.checking}
                initialValues={{
                  role:
                    userDetail.user.accountType === "customer"
                      ? "brand_editor"
                      : "tenant_admin",
                }}
                layout="vertical"
                onFinish={(values) => void saveUserOrganization(values)}
              >
                {userGrant.error ? (
                  <Alert
                    type={userGrant.refreshFailed ? "warning" : "error"}
                    showIcon
                    message={
                      userGrant.refreshFailed
                        ? "企业权限已保存，目录未刷新"
                        : "企业权限未保存"
                    }
                    description={userGrant.error}
                    style={{ marginBottom: 16 }}
                  />
                ) : null}
                <Row gutter={12}>
                  <Col md={12} xs={24}>
                    <Form.Item
                      label="目标企业"
                      name="organizationId"
                      rules={[{ required: true, message: "请选择目标企业" }]}
                    >
                      <Select
                        filterOption={false}
                        onOpenChange={(open) => {
                          if (open) void searchUserOrganizations();
                        }}
                        onSearch={(value) =>
                          void searchUserOrganizations(value)
                        }
                        options={userOrganizationOptions.map(
                          (organization) => ({
                            label: `${organization.name} · ${organization.answerbitBrandId ?? "品牌未绑定"}`,
                            value: organization.id,
                          }),
                        )}
                        placeholder="搜索腾讯企业名称"
                        showSearch
                      />
                    </Form.Item>
                  </Col>
                  <Col md={12} xs={24}>
                    <Form.Item
                      label="企业角色"
                      name="role"
                      rules={[{ required: true, message: "请选择企业角色" }]}
                    >
                      <Select
                        options={
                          userDetail.user.accountType === "customer"
                            ? [
                                { label: "品牌管理员", value: "brand_admin" },
                                { label: "品牌编辑", value: "brand_editor" },
                                { label: "品牌查看者", value: "brand_viewer" },
                              ]
                            : [{ label: "企业管理员", value: "tenant_admin" }]
                        }
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Button
                  aria-label="保存企业权限"
                  htmlType="submit"
                  loading={userGrant.busy}
                  type="primary"
                >
                  保存企业权限
                </Button>
                {userGrant.checking ? (
                  <Button
                    aria-label="核对操作结果"
                    disabled={false}
                    loading={userGrant.busy}
                    onClick={() => void userGrant.run()}
                    style={{ marginLeft: 8 }}
                  >
                    核对操作结果
                  </Button>
                ) : null}
              </Form>
            </Card>

            <Card size="small" title="企业成员关系">
              <Table<UserDetail["memberships"][number]>
                columns={[
                  {
                    title: "企业",
                    dataIndex: "organizationName",
                    render: (value: string, item) => (
                      <Button
                        onClick={() =>
                          void openOrganization(item.organizationId)
                        }
                        style={{ padding: 0 }}
                        type="link"
                      >
                        {value}
                      </Button>
                    ),
                  },
                  {
                    title: "企业角色",
                    dataIndex: "role",
                    render: (value: string | null) => (
                      <Tag color={value ? "blue" : "default"}>
                        {value ? (roleLabels[value] ?? value) : "未分配"}
                      </Tag>
                    ),
                  },
                  {
                    title: "功能授权",
                    key: "features",
                    width: 300,
                    render: (_, item) => {
                      const scope = userDetail.featureScopes.find(
                        (candidate) =>
                          candidate.organizationId === item.organizationId,
                      );
                      const features =
                        scope?.features ?? allOrganizationFeatures;
                      return features.length ? (
                        <Space size={[0, 4]} wrap>
                          {features.map((feature) => (
                            <Tag key={feature}>
                              {organizationFeatureLabel.get(feature) ?? feature}
                            </Tag>
                          ))}
                        </Space>
                      ) : (
                        <Tag color="red">全部功能已关闭</Tag>
                      );
                    },
                  },
                  {
                    title: "成员状态",
                    dataIndex: "memberStatus",
                    render: (value: string) => (
                      <Badge
                        status={value === "active" ? "success" : "default"}
                        text={value === "active" ? "正常" : "已停用"}
                      />
                    ),
                  },
                  {
                    title: "企业状态",
                    dataIndex: "organizationStatus",
                    responsive: ["md"],
                    render: (value: string) => (
                      <Badge
                        status={value === "active" ? "success" : "warning"}
                        text={value === "active" ? "正常" : "受限"}
                      />
                    ),
                  },
                  {
                    title: "操作",
                    key: "action",
                    width: 110,
                    render: (_, item) => (
                      <AdminMemberActions
                        onlyRemove
                        organization={{
                          id: item.organizationId,
                          name: item.organizationName,
                        }}
                        member={{
                          id: item.memberId,
                          name: userDetail.user.name,
                          username: userDetail.user.username,
                          status: item.memberStatus,
                        }}
                        onChanged={async () => {
                          await Promise.all([
                            openUser(userDetail.user.id, true),
                            load(),
                          ]);
                        }}
                      />
                    ),
                  },
                ]}
                dataSource={userDetail.memberships}
                locale={{ emptyText: <Empty description="尚未加入任何企业" /> }}
                pagination={false}
                rowKey="memberId"
                onHeaderRow={focusableTableHeaderRow}
                scroll={{ x: 920 }}
                size="small"
              />
            </Card>
            <Card size="small" title="显式品牌权限">
              <Table<UserDetail["brandAccess"][number]>
                columns={[
                  { title: "企业", dataIndex: "organizationName" },
                  {
                    title: "品牌 ID",
                    dataIndex: "brandId",
                    render: (value: string) => (
                      <Typography.Text copyable>{value}</Typography.Text>
                    ),
                  },
                  {
                    title: "角色",
                    dataIndex: "role",
                    render: (value: string) => (
                      <Tag color="blue">{roleLabels[value] ?? value}</Tag>
                    ),
                  },
                ]}
                dataSource={userDetail.brandAccess}
                locale={{ emptyText: <Empty description="暂无显式品牌权限" /> }}
                pagination={false}
                rowKey="id"
                onHeaderRow={focusableTableHeaderRow}
                scroll={{ x: 640 }}
                size="small"
              />
            </Card>
          </Flex>
        ) : null}
      </Drawer>

      <Modal
        footer={null}
        onCancel={() => setGrantOrganization(null)}
        open={Boolean(grantOrganization)}
        title={(grantOrganization?.name ?? "") + " · 资产调整"}
        forceRender
        width={680}
      >
        <Alert
          description="入账进入企业资金池；手动扣减可选择企业资金池或品牌账户，须填写原因并保留流水。"
          showIcon
          style={{ marginBottom: 20 }}
          type="info"
        />
        <Form<GrantForm>
          form={grantForm}
          disabled={Boolean(
            grantOrganization && busy === `grant-${grantOrganization.id}`,
          )}
          onValuesChange={() => {
            grantKey.current = crypto.randomUUID();
          }}
          layout="vertical"
          onFinish={(values) => void grant(values)}
          size="large"
        >
          <Form.Item label="操作" name="operation" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { label: "入账", value: "grant" },
                { label: "手动扣减", value: "deduct" },
              ]}
            />
          </Form.Item>
          {grantOperation === "deduct" ? (
            <Form.Item
              label="扣减账户"
              name="account"
              rules={[{ required: true }]}
            >
              <Radio.Group
                options={[
                  { label: "企业资金池", value: "enterprise" },
                  {
                    label: "品牌账户",
                    value: "brand",
                    disabled: !grantOrganization?.answerbitBrandId,
                  },
                ]}
              />
            </Form.Item>
          ) : null}
          <Form.Item label="资产" name="asset" rules={[{ required: true }]}>
            <Select
              options={[
                { label: "腾讯能力积分", value: "answerbit_points" },
                {
                  label: "发布人民币余额（元）",
                  value: "publication_cny",
                },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="数量"
            name="amount"
            rules={[{ required: true, message: "请输入数量" }]}
          >
            <InputNumber min={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            label="调整原因"
            name="reason"
            rules={[
              { required: true, message: "请输入调整原因" },
              { min: 4, message: "至少 4 个字符" },
            ]}
          >
            <Input />
          </Form.Item>
          <Button
            block
            htmlType="submit"
            loading={Boolean(
              grantOrganization && busy === "grant-" + grantOrganization.id,
            )}
            type="primary"
          >
            {grantOperation === "deduct" ? "确认手动扣减" : "确认入账"}
          </Button>
        </Form>
      </Modal>

      <Modal
        cancelText="取消"
        confirmLoading={Boolean(
          editingChannel && busy === "channel-" + editingChannel.id,
        )}
        okText="保存分级售价"
        onCancel={() => setEditingChannel(null)}
        onOk={() => void saveChannelPrice()}
        open={Boolean(editingChannel)}
        title={`分级定价 · ${editingChannel?.name ?? ""}`}
        width={760}
      >
        {editingChannel ? (
          <Flex gap={16} vertical>
            <Descriptions bordered column={mobile ? 1 : 3} size="small">
              <Descriptions.Item label="来源">
                {editingChannel.provider === "frog_media"
                  ? "媒体发布"
                  : "人工渠道"}
              </Descriptions.Item>
              <Descriptions.Item label="采购成本">
                {editingChannel.provider === "frog_media"
                  ? money(editingChannel.providerCostAmount)
                  : "自营渠道"}
              </Descriptions.Item>
              <Descriptions.Item label="平台状态">
                {editingChannel.status === "active" ? "启用" : "下架"}
              </Descriptions.Item>
            </Descriptions>
            <Alert
              message={
                editingChannel.provider === "frog_media"
                  ? "留空使用等级加价规则自动计算；填写后使用固定售价。聚合渠道售价不得低于采购成本，避免倒挂。"
                  : "留空沿用人工渠道基础价；填写后可为该客户等级设置固定售价。"
              }
              showIcon
              type="info"
            />
            <Row gutter={[12, 12]}>
              {pricingTiers.map((tier) => (
                <Col key={tier} md={12} xs={24}>
                  <Typography.Text strong>
                    {pricingTierMeta[tier].label}
                  </Typography.Text>
                  <InputNumber
                    suffix="元"
                    min={
                      editingChannel.provider === "frog_media"
                        ? editingChannel.providerCostAmount / 100
                        : 0
                    }
                    onChange={(value) =>
                      setChannelTierPrices((current) => ({
                        ...current,
                        [tier]: value,
                      }))
                    }
                    placeholder={`自动 ${money(
                      editingChannel.tierPrices[tier].priceAmount,
                    )}`}
                    precision={2}
                    style={{ marginTop: 8, width: "100%" }}
                    value={channelTierPrices[tier]}
                  />
                </Col>
              ))}
            </Row>
          </Flex>
        ) : null}
      </Modal>

      <Modal
        cancelText="取消"
        confirmLoading={Boolean(
          editingPricingTier &&
            busy === `pricing-tier-${editingPricingTier.tier}`,
        )}
        okText="保存规则"
        onCancel={() => {
          setEditingPricingTier(null);
          pricingTierRuleForm.resetFields();
        }}
        onOk={() => pricingTierRuleForm.submit()}
        open={Boolean(editingPricingTier)}
        title={`价格规则 · ${editingPricingTier?.displayName ?? ""}`}
        width={680}
      >
        <Form<PricingTierRuleForm>
          form={pricingTierRuleForm}
          layout="vertical"
          onFinish={(values) => void savePricingTierRule(values)}
          size="large"
        >
          <Form.Item
            label="等级名称"
            name="displayName"
            rules={[{ required: true, message: "请输入等级名称" }]}
          >
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col sm={12} xs={24}>
              <Form.Item
                extra="按采购成本加价，30 表示成本 ¥100 的默认售价为 ¥130。"
                label="发布加价率"
                name="publicationMarkupPercent"
                rules={[{ required: true, message: "请输入发布加价率" }]}
              >
                <InputNumber min={0} style={{ width: "100%" }} suffix="%" />
              </Form.Item>
            </Col>
            <Col sm={12} xs={24}>
              <Form.Item
                extra="按功能基础积分调价，30 表示基础 100 积分扣 130；-10 表示扣 90。"
                label="积分加价率"
                name="pointMarkupPercent"
                rules={[{ required: true, message: "请输入积分加价率" }]}
              >
                <InputNumber min={-100} style={{ width: "100%" }} suffix="%" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </Layout>
  );
}
