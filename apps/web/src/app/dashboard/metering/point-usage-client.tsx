"use client";

import {
  CalendarOutlined,
  ReloadOutlined,
  RiseOutlined,
  SafetyCertificateOutlined,
  UndoOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Empty,
  Flex,
  Row,
  Select,
  Segmented,
  Space,
  Statistic,
  Tag,
  theme,
  Typography,
  type TableColumnsType,
} from "antd";
import { useSearchParams } from "next/navigation";
import { pointUsageQuerySchema, type PointUsageQuery } from "@geo/contracts";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibleTable } from "../../accessible-table";
import {
  ScopeFields,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";

type UsageOperation = "consume" | "restore";
type UsageTransaction = {
  id: string;
  brandId: string;
  brandName: string | null;
  operation: UsageOperation;
  amount: number;
  sourceBalanceAfter: number | null;
  targetBalanceAfter: number | null;
  referenceType: string;
  referenceId: string;
  reason: string;
  actorUserId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  createdAt: string;
};
type PointUsage = {
  balance: number;
  organizationBalance: number | null;
  summary: {
    consumed: number;
    restored: number;
    transactionCount: number;
  };
  list: UsageTransaction[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pages: number;
  };
};

const queryKeys = {
  beginDate: "usageBeginDate",
  endDate: "usageEndDate",
  operation: "usageOperation",
  page: "usagePage",
  pageSize: "usagePageSize",
} as const;
const resetQueryKeys = [
  "usageOrganizationId",
  "usageBrandId",
  ...Object.values(queryKeys),
];
const number = new Intl.NumberFormat("zh-CN");
const beijingToday = () =>
  dayjs(new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10));
const defaultRange = (): [Dayjs, Dayjs] => [
  beijingToday().subtract(29, "day"),
  beijingToday(),
];
const operationOptions = [
  { label: "全部收支", value: "all" },
  { label: "仅看消耗", value: "consume" },
  { label: "仅看返还", value: "restore" },
] as const;
const referenceName = (value: string) =>
  ({
    feature_usage: "业务功能",
    feature_usage_failed: "失败返还",
  })[value] ?? "积分业务";

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "积分用量加载失败");
  return body.data as T;
}

export function PointUsageClient({
  organizations,
}: {
  organizations: ScopeOrganization[];
}) {
  const scope = useAnswerBitScope(organizations, resetQueryKeys);
  const { token } = theme.useToken();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("usageView");
  const [view, setView] = useState<"organization" | "brand">(() =>
    requestedView === "organization" || requestedView === "brand"
      ? requestedView
      : searchParams.get("brandId")
        ? "brand"
        : "organization",
  );
  const canViewOrganization =
    organizations.find((item) => item.id === scope.organizationId)?.role ===
    "tenant_admin";
  const enterpriseView = canViewOrganization && view === "organization";
  // @project-doc docs/domains/balance_and_publication.md#point_usage
  useEffect(() => {
    if (!scope.brandId) return;
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("usageView");
    const next = !canViewOrganization
      ? "brand"
      : requested === "brand" || requested === "organization"
        ? requested
        : view;
    if (next !== view) setView(next);
    if (requested !== next) {
      url.searchParams.set("usageView", next);
      window.history.replaceState(null, "", url);
    }
  }, [
    requestedView,
    scope.brandId,
    scope.organizationId,
    canViewOrganization,
    view,
  ]);

  const scopeReady =
    scope.scopeRestored &&
    Boolean(scope.organizationId) &&
    (enterpriseView || Boolean(scope.teamBindingId && scope.brandId));
  const initialRange = useMemo(defaultRange, []);
  const baseQuery = {
    organizationId:
      scope.organizationId || "11111111-1111-4111-8111-111111111111",
    ...(!enterpriseView
      ? {
          teamBindingId:
            scope.teamBindingId || "11111111-1111-4111-8111-111111111111",
          brandId: scope.brandId || "pending",
        }
      : {}),
    beginDate: initialRange[0].format("YYYY-MM-DD"),
    endDate: initialRange[1].format("YYYY-MM-DD"),
  };
  const raw: Record<string, unknown> = { ...baseQuery };
  if (
    searchParams.get("usageOrganizationId") === scope.organizationId &&
    (searchParams.get("usageBrandId") ?? "") ===
      (enterpriseView ? "" : scope.brandId)
  )
    for (const [field, key] of Object.entries(queryKeys)) {
      const value = searchParams.get(key);
      if (value !== null) raw[field] = value;
    }
  const parsed = pointUsageQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : pointUsageQuerySchema.parse(baseQuery);
  const range: [Dayjs, Dayjs] = [dayjs(query.beginDate), dayjs(query.endDate)];
  const operation = query.operation ?? "all";
  function change(
    patch: Partial<PointUsageQuery>,
    nextView = enterpriseView ? "organization" : "brand",
  ) {
    const next = { ...query, page: 1, ...patch };
    const url = new URL(window.location.href);
    url.searchParams.set("organizationId", scope.organizationId);
    if (scope.brandId) url.searchParams.set("brandId", scope.brandId);
    url.searchParams.set("usageView", nextView);
    url.searchParams.set("usageOrganizationId", scope.organizationId);
    url.searchParams.set(
      "usageBrandId",
      nextView === "organization" ? "" : scope.brandId,
    );
    for (const [field, key] of Object.entries(queryKeys)) {
      const value = next[field as keyof typeof queryKeys];
      if (value !== undefined) url.searchParams.set(key, String(value));
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url);
  }
  const [result, setResult] = useState<{
    key: string;
    data: PointUsage;
  } | null>(null);
  const params = new URLSearchParams(
    Object.entries(query).map(([key, value]) => [key, String(value)]),
  );
  const dataKey = `${params.toString()}`;
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const error = failure?.key === dataKey ? failure.message : "";
  const data = !error && result?.key === dataKey ? result.data : null;
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current;
      if (!scopeReady) {
        setResult(null);
        setLoading(false);
        setFailure(undefined);
        return;
      }
      setLoading(true);
      setFailure(undefined);
      try {
        const next = await request<PointUsage>(
          `/api/v1/point-usage?${dataKey}`,
          signal,
        );
        if (!signal?.aborted && version === requestVersion.current)
          setResult({ key: dataKey, data: next });
      } catch (reason) {
        if (!signal?.aborted && version === requestVersion.current)
          setFailure({
            key: dataKey,
            message:
              reason instanceof Error ? reason.message : "积分用量加载失败",
          });
      } finally {
        if (!signal?.aborted && version === requestVersion.current)
          setLoading(false);
      }
    },
    [dataKey, scopeReady],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      requestVersion.current += 1;
    };
  }, [load]);

  const columns = useMemo<TableColumnsType<UsageTransaction>>(
    () => [
      {
        title: "发生时间（北京时间）",
        dataIndex: "createdAt",
        width: 180,
        render: (value: string) =>
          new Date(value).toLocaleString("zh-CN", {
            timeZone: "Asia/Shanghai",
          }),
      },
      ...(enterpriseView
        ? [
            {
              title: "品牌",
              key: "brand",
              width: 160,
              render: (_: unknown, item: UsageTransaction) =>
                item.brandName ?? item.brandId,
            },
          ]
        : []),
      {
        title: "积分变动",
        key: "amount",
        width: 140,
        render: (_, item) => (
          <Typography.Text
            strong
            type={item.operation === "consume" ? "danger" : "success"}
          >
            {item.operation === "consume" ? "−" : "+"}
            {number.format(item.amount)}
          </Typography.Text>
        ),
      },
      {
        title: "类型",
        dataIndex: "operation",
        width: 110,
        render: (value: UsageOperation) => (
          <Tag
            style={{
              color:
                value === "consume"
                  ? token.colorErrorText
                  : token.colorSuccessText,
              backgroundColor:
                value === "consume" ? token.colorErrorBg : token.colorSuccessBg,
              borderColor:
                value === "consume"
                  ? token.colorErrorBorder
                  : token.colorSuccessBorder,
            }}
          >
            {value === "consume" ? "功能消耗" : "失败返还"}
          </Tag>
        ),
      },
      {
        title: "业务说明",
        key: "reason",
        width: 280,
        render: (_, item) => (
          <Space direction="vertical" size={0}>
            <Typography.Text>{item.reason}</Typography.Text>
            <Typography.Text type="secondary">
              {referenceName(item.referenceType)} · {item.referenceId}
            </Typography.Text>
          </Space>
        ),
      },
      {
        title: "操作用户",
        key: "actor",
        width: 180,
        render: (_, item) =>
          item.actorUserId ? (
            <Space direction="vertical" size={0}>
              <Typography.Text>
                {item.actorName ?? "当前企业成员"}
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
        title: "变动后余额",
        key: "balanceAfter",
        align: "right",
        width: 140,
        render: (_, item) =>
          number.format(
            (item.operation === "consume"
              ? item.sourceBalanceAfter
              : item.targetBalanceAfter) ?? 0,
          ),
      },
    ],
    [enterpriseView, token],
  );

  const summary = data?.summary ?? {
    consumed: 0,
    restored: 0,
    transactionCount: 0,
  };
  const periodLabel = `${range[0].format("YYYY-MM-DD")} 至 ${range[1].format("YYYY-MM-DD")}`;
  const showOrganizationBalance = canViewOrganization;
  const cardSpan = showOrganizationBalance ? 6 : 8;

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Row gutter={[16, 16]}>
        <Col lg={cardSpan} sm={12} xs={24}>
          <Card loading={loading && !data}>
            <Statistic
              prefix={<WalletOutlined />}
              title={
                enterpriseView ? "企业品牌可用积分合计" : "当前品牌可用积分"
              }
              value={data?.balance}
              formatter={(value) => (data ? number.format(Number(value)) : "—")}
            />
            <Typography.Text type="secondary">
              {enterpriseView ? "企业内全部品牌账户" : "本系统品牌积分账户"}
            </Typography.Text>
          </Card>
        </Col>
        {showOrganizationBalance ? (
          <Col lg={cardSpan} sm={12} xs={24}>
            <Card loading={loading && !data}>
              <Statistic
                prefix={<SafetyCertificateOutlined />}
                title="企业可分配积分"
                value={data?.organizationBalance ?? 0}
                formatter={(value) =>
                  data ? number.format(Number(value)) : "—"
                }
              />
              <Typography.Text type="secondary">
                可划分到企业品牌
              </Typography.Text>
            </Card>
          </Col>
        ) : null}
        <Col lg={cardSpan} sm={12} xs={24}>
          <Card loading={loading && !data}>
            <Statistic
              prefix={<RiseOutlined />}
              title="周期积分消耗"
              value={summary.consumed}
              formatter={(value) => (data ? number.format(Number(value)) : "—")}
            />
            <Typography.Text type="secondary">{periodLabel}</Typography.Text>
          </Card>
        </Col>
        <Col lg={cardSpan} sm={12} xs={24}>
          <Card loading={loading && !data}>
            <Statistic
              prefix={<UndoOutlined />}
              title="周期失败返还"
              value={summary.restored}
              formatter={(value) => (data ? number.format(Number(value)) : "—")}
            />
            <Typography.Text type="secondary">
              {data
                ? `周期净消耗 ${number.format(summary.consumed - summary.restored)} 积分`
                : "等待统计数据"}
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      <Card
        title="积分消耗明细"
        extra={
          <Button
            aria-label="刷新数据"
            icon={<ReloadOutlined />}
            loading={loading}
            disabled={!scopeReady}
            onClick={() => void load()}
          >
            刷新数据
          </Button>
        }
      >
        {canViewOrganization ? (
          <Segmented
            aria-label="积分统计范围"
            disabled={!scope.brandId}
            value={view}
            onChange={(value) => {
              const nextView = value as "organization" | "brand";
              change({}, nextView);
              setView(nextView);
            }}
            options={[
              { label: "企业整体", value: "organization" },
              { label: "当前品牌", value: "brand" },
            ]}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {!parsed.success ? (
          <Alert
            type="warning"
            showIcon
            message="积分筛选参数无效，请重新选择或清除筛选"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Flex gap={12} wrap align="end">
          <div style={{ flex: "1 1 420px", minWidth: 260 }}>
            <ScopeFields
              organizations={organizations}
              scope={scope}
              showBrand={!enterpriseView}
            />
          </div>
          <Flex style={{ flex: "1 1 280px", minWidth: 260 }} vertical>
            <label htmlFor="point-usage-date-range">
              <Typography.Text type="secondary">统计周期</Typography.Text>
            </label>
            <DatePicker.RangePicker
              disabled={!scopeReady}
              allowClear={false}
              disabledDate={(current) => current.isAfter(beijingToday(), "day")}
              id="point-usage-date-range"
              onChange={(value) => {
                if (value?.[0] && value[1])
                  change({
                    beginDate: value[0].format("YYYY-MM-DD"),
                    endDate: value[1].format("YYYY-MM-DD"),
                  });
              }}
              presets={[
                {
                  label: "近 7 天",
                  value: [beijingToday().subtract(6, "day"), beijingToday()],
                },
                { label: "近 30 天", value: defaultRange() },
                {
                  label: "近 90 天",
                  value: [beijingToday().subtract(89, "day"), beijingToday()],
                },
              ]}
              style={{ width: "100%" }}
              value={range}
            />
          </Flex>
          <Flex style={{ flex: "0 1 180px", minWidth: 170 }} vertical>
            <label htmlFor="point-usage-operation">
              <Typography.Text type="secondary">记录类型</Typography.Text>
            </label>
            <Select<"all" | UsageOperation>
              id="point-usage-operation"
              disabled={!scopeReady}
              onChange={(value) =>
                change({ operation: value === "all" ? undefined : value })
              }
              options={[...operationOptions]}
              value={operation}
            />
          </Flex>
          <Button
            disabled={!scopeReady}
            onClick={() => {
              const [begin, end] = defaultRange();
              change({
                beginDate: begin.format("YYYY-MM-DD"),
                endDate: end.format("YYYY-MM-DD"),
                operation: undefined,
                pageSize: 20,
              });
            }}
          >
            清除筛选
          </Button>
        </Flex>

        {error || scope.error ? (
          <Alert
            message={error || scope.error}
            action={
              error ? (
                <Button
                  aria-label="重试积分用量"
                  loading={loading}
                  onClick={() => void load()}
                >
                  重试
                </Button>
              ) : undefined
            }
            showIcon
            style={{ marginTop: 16 }}
            type="error"
          />
        ) : null}

        <Divider style={{ margin: "20px 0 12px" }} />
        <Flex
          align="center"
          justify="space-between"
          style={{ marginBottom: 12 }}
          wrap
        >
          <Space>
            <CalendarOutlined />
            <Typography.Text type="secondary">{periodLabel}</Typography.Text>
          </Space>
          <Typography.Text type="secondary">
            当前筛选共 {data ? number.format(data.pagination.total) : "—"} 条
          </Typography.Text>
        </Flex>
        <AccessibleTable<UsageTransaction>
          columns={columns}
          dataSource={data?.list ?? []}
          loading={loading}
          locale={{
            emptyText: (
              <Empty
                description={
                  error || scope.error
                    ? "积分记录读取失败，请重试"
                    : loading
                      ? "正在读取积分明细"
                      : "当前范围内暂无积分消耗记录"
                }
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          onChange={(pagination) => {
            change({
              page:
                pagination.pageSize !== query.pageSize
                  ? 1
                  : (pagination.current ?? 1),
              pageSize: pagination.pageSize ?? 20,
            });
          }}
          pagination={
            data
              ? {
                  current: data.pagination.page,
                  pageSize: query.pageSize,
                  pageSizeOptions: [10, 20, 50, 100],
                  showSizeChanger: true,
                  showTotal: (total) => `共 ${total} 条`,
                  total: data.pagination.total,
                }
              : false
          }
          rowKey="id"
          scroll={{ x: enterpriseView ? 1200 : 1040 }}
          scrollRegionLabel="积分消耗明细，可横向滚动"
        />
      </Card>
    </Space>
  );
}
