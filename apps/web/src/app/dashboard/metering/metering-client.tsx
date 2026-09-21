"use client";
import {
  answerBitAvailableCredits,
  answerBitCreditUtilization,
} from "@geo/core/answerbit-metering";
import { ExpandAltOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Flex,
  Input,
  InputNumber,
  List,
  Pagination,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessibleTable } from "../../accessible-table";
import {
  ScopeFields,
  scopeQuery,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";
import { projectCapacity } from "./capacity";

type Usage = {
  plan: {
    valid_from: number;
    valid_until: number;
    quotas: {
      quota_type: string;
      total_amount: number;
      used_amount: number;
      reset_time: number;
    }[];
  };
  credit?: { team_id: string; total_amount: number; used_amount: number };
};
type Subscription = {
  plan_id: string;
  plan_name: string;
  tier: string;
  status: number;
  started_at: number;
  expired_at: number;
  billing_period: number;
  billing_amount: number;
  current_cycle_start: number;
  current_cycle_end: number;
  is_trial: boolean;
};
type Credits = {
  team_id: string;
  total_amount: number;
  used_amount: number;
  credit_details: {
    credit_id: string;
    source_type: number;
    total_amount: number;
    used_amount: number;
    expire_time: number;
    status: number;
  }[];
};
type Breakdown = {
  period_start: number;
  period_end: number;
  total_credit_used: number;
  total_quota_amount: number;
  usages: {
    quota_type: string;
    quota_amount: number;
    credit_used: number;
    percent: number;
  }[];
};
type Trend = {
  date: string;
  quota_type: string;
  quota_amount: number;
  credit_used: number;
};
type Rank = { brand_id: string; brand_name: string; credit_used: number };
type Bill = {
  bill_id: string;
  bill_type: string;
  credit_change: number;
  is_pending: boolean;
  created_time: number;
  operator_name: string;
  brand_name: string;
};
type SubscriptionLog = {
  log_id: string;
  action: string;
  action_text: string;
  message: string;
  operator_name: string;
  created_at: number;
};
type QuotaOverride = {
  quota_type: string;
  quota_limit: number;
  reason: string;
  created_at: number;
  is_effective: boolean;
};
type ListTab = "bills" | "logs" | "overrides";
type BillStatus = 0 | 1 | 2;
const day = (value: Date) => value.toISOString().slice(0, 10);
const unix = (value: string, end = false) =>
  Math.floor(
    new Date(`${value}T${end ? "23:59:59" : "00:00:00"}+08:00`).getTime() /
      1000,
  );
const when = (value: number) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
        new Date(value * 1000),
      )
    : "—";
const quotaName = (value: string) =>
  ({
    article_generate: "文章生成",
    prompt_query: "问题采集",
    report_export: "报表导出",
    max_brand: "监控品牌",
    max_member: "团队成员",
    max_prompt: "用户提问",
    max_competitor: "竞品追踪",
    brand: "品牌",
    member: "成员",
  })[value] ?? value.replaceAll("_", " ");
const creditSourceName = (value: number) =>
  ({ 1: "套餐发放", 2: "充值", 3: "人工调整" })[value] ?? `来源 ${value}`;
const creditStatusName = (value: number) =>
  ({
    1: "可用",
    2: "已用完",
    3: "已过期",
    4: "已关闭",
    5: "冻结中",
  })[value] ?? `状态 ${value}`;
const recordKey = (
  record: Bill | SubscriptionLog | QuotaOverride,
  index: number,
) =>
  "bill_id" in record
    ? record.bill_id
    : "log_id" in record
      ? record.log_id
      : `${record.created_at}-${record.quota_type}-${index}`;
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "计量数据加载失败");
  return body.data as T;
}

export function MeteringClient({
  canViewPlatformAccount,
  organizations,
  showCapacityExpansion = false,
}: {
  canViewPlatformAccount: boolean;
  organizations: ScopeOrganization[];
  showCapacityExpansion?: boolean;
}) {
  const scope = useAnswerBitScope(organizations);
  const initial = useMemo(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    return { start: day(start), end: day(end) };
  }, []);
  const { organizationId, teamBindingId, brandId } = scope;
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [capacityUsage, setCapacityUsage] = useState<Usage | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [quotaTypes, setQuotaTypes] = useState<string[]>([]);
  const [capacityQuantity, setCapacityQuantity] = useState(1);
  const [capacityPurchasing, setCapacityPurchasing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [tab, setTab] = useState<ListTab>("bills");
  const [page, setPage] = useState(1);
  const [recordKeyword, setRecordKeyword] = useState("");
  const [billStatus, setBillStatus] = useState<BillStatus>(0);
  const [records, setRecords] = useState<
    Array<Bill | SubscriptionLog | QuotaOverride>
  >([]);
  const [recordTotal, setRecordTotal] = useState(0);
  const base = useCallback(
    () =>
      scopeQuery({
        organizationId,
        teamBindingId,
        ...(brandId ? { brandId } : {}),
      }),
    [organizationId, teamBindingId, brandId],
  );
  const loadOverview = useCallback(async () => {
    if (!teamBindingId || !brandId) return;
    setLoading(true);
    setMessage("");
    const periodParams = new URLSearchParams(base());
    periodParams.set("startUnix", String(unix(startDate)));
    periodParams.set("endUnix", String(unix(endDate, true)));
    if (quotaTypes.length) periodParams.set("quotaTypes", quotaTypes.join(","));
    const period = periodParams.toString();
    try {
      const nextUsage = await request<Usage>(
        `/api/v1/answerbit/metering/usage?${base()}`,
      );
      const nextBreakdown = await request<Breakdown>(
        `/api/v1/answerbit/metering/credit-usage?${period}`,
      );
      const nextTrend = await request<{ trends: Trend[] }>(
        `/api/v1/answerbit/metering/credit-trends?${period}`,
      );
      const nextRanks = await request<Rank[]>(
        `/api/v1/answerbit/metering/credit-ranks?${period}`,
      );
      setUsage(nextUsage);
      setBreakdown(nextBreakdown);
      setTrends(nextTrend.trends);
      setRanks(nextRanks);
      if (canViewPlatformAccount) {
        if (showCapacityExpansion) {
          const capacityScope = scopeQuery({
            organizationId,
            teamBindingId,
          });
          const nextCapacityUsage = await request<Usage>(
            `/api/v1/answerbit/metering/usage?${capacityScope}`,
          );
          setCapacityUsage(nextCapacityUsage);
        } else {
          setCapacityUsage(null);
        }
        const nextSubscription = await request<Subscription>(
          `/api/v1/answerbit/metering/subscription?${base()}`,
        );
        const nextCredits = await request<Credits>(
          `/api/v1/answerbit/metering/credits?${base()}`,
        );
        setSubscription(nextSubscription);
        setCredits(nextCredits);
      } else {
        setCapacityUsage(null);
        setSubscription(null);
        setCredits(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "计量数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [
    teamBindingId,
    brandId,
    startDate,
    endDate,
    quotaTypes,
    base,
    canViewPlatformAccount,
    organizationId,
    showCapacityExpansion,
  ]);
  const loadRecords = useCallback(async () => {
    if (!teamBindingId || !brandId) return;
    const recordParams = new URLSearchParams(base());
    recordParams.set("page", String(page));
    recordParams.set("pageSize", "20");
    if (!canViewPlatformAccount && tab !== "bills") return;
    if (tab !== "overrides" && recordKeyword)
      recordParams.set("keyword", recordKeyword);
    if (tab === "bills") {
      recordParams.set("startTime", String(unix(startDate)));
      recordParams.set("endTime", String(unix(endDate, true)));
      recordParams.set("status", String(billStatus));
    }
    const endpoint =
      tab === "bills"
        ? "credit-bills"
        : tab === "logs"
          ? "subscription-logs"
          : "quota-overrides";
    try {
      setRecordsLoading(true);
      const data = await request<{
        bills?: Bill[];
        list?: Array<SubscriptionLog | QuotaOverride>;
        total: number;
      }>(`/api/v1/answerbit/metering/${endpoint}?${recordParams.toString()}`);
      setRecords(data.bills ?? data.list ?? []);
      setRecordTotal(data.total);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "计量记录加载失败");
    } finally {
      setRecordsLoading(false);
    }
  }, [
    teamBindingId,
    brandId,
    base,
    page,
    tab,
    recordKeyword,
    startDate,
    endDate,
    billStatus,
    canViewPlatformAccount,
  ]);
  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);
  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);
  useEffect(() => {
    const refresh = async () => {
      if (document.hidden || !navigator.onLine) return;
      await loadOverview();
      await loadRecords();
    };
    const triggerRefresh = () => void refresh();
    const timer = window.setInterval(triggerRefresh, 60_000);
    document.addEventListener("visibilitychange", triggerRefresh);
    window.addEventListener("online", triggerRefresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", triggerRefresh);
      window.removeEventListener("online", triggerRefresh);
    };
  }, [loadOverview, loadRecords]);
  const available = credits ? answerBitAvailableCredits(credits) : 0;
  const utilization = credits ? answerBitCreditUtilization(credits) : 0;
  const capacityUnitCost = 400;
  const projectedCapacityCost = capacityQuantity * capacityUnitCost;
  const monitorBrandQuota = (capacityUsage ?? usage)?.plan.quotas.find((item) =>
    ["max_brand", "brand", "monitor_brand", "brand_monitor"].includes(
      item.quota_type,
    ),
  );
  const capacityProjection = monitorBrandQuota
    ? projectCapacity(monitorBrandQuota, capacityQuantity)
    : null;
  const purchaseCapacity = useCallback(async () => {
    if (!organizationId || !teamBindingId || !brandId) return;
    setCapacityPurchasing(true);
    setMessage("");
    setSuccessMessage("");
    try {
      await request("/api/v1/answerbit/metering/quota-purchases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          teamBindingId,
          brandId,
          quotaType: "max_brand",
          quotaAmount: capacityQuantity,
        }),
      });
      setSuccessMessage(
        `腾讯已确认扩容 ${capacityQuantity.toLocaleString()} 个监控品牌容量，正在刷新积分与配额。`,
      );
      await loadOverview();
      await loadRecords();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "监控品牌扩容失败");
    } finally {
      setCapacityPurchasing(false);
    }
  }, [
    organizationId,
    teamBindingId,
    brandId,
    capacityQuantity,
    loadOverview,
    loadRecords,
  ]);
  const rankColumns: TableColumnsType<Rank> = [
    {
      title: "排名",
      width: 72,
      render: (_, __, index) => index + 1,
    },
    { title: "品牌", dataIndex: "brand_name" },
    {
      title: "积分消耗",
      dataIndex: "credit_used",
      align: "right",
      render: (value: number) => value.toLocaleString(),
    },
  ];

  const trendColumns: TableColumnsType<Trend> = [
    { title: "日期", dataIndex: "date", width: 140 },
    {
      title: "能力",
      dataIndex: "quota_type",
      render: (value: string) => quotaName(value),
    },
    {
      title: "配额量",
      dataIndex: "quota_amount",
      align: "right",
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: "积分消耗",
      dataIndex: "credit_used",
      align: "right",
      render: (value: number) => value.toLocaleString(),
    },
  ];

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Row gutter={[16, 16]}>
        {canViewPlatformAccount ? (
          <Col lg={8} xs={24}>
            <Card title="当前订阅">
              <Typography.Title level={3} style={{ marginTop: 0 }}>
                {subscription?.plan_name ?? "等待数据"}
              </Typography.Title>
              <Space style={{ marginBottom: 16 }} wrap>
                <Tag color={subscription?.status === 1 ? "success" : "default"}>
                  {subscription?.status === 1
                    ? "生效中"
                    : subscription
                      ? "状态 " + subscription.status
                      : "未加载"}
                </Tag>
                <Tag color={subscription?.is_trial ? "gold" : "blue"}>
                  {subscription?.is_trial
                    ? "试用"
                    : (subscription?.tier ?? "—")}
                </Tag>
              </Space>
              <Descriptions
                column={1}
                items={[
                  {
                    key: "validity",
                    label: "订阅有效期",
                    children: subscription
                      ? when(subscription.started_at) +
                        " — " +
                        when(subscription.expired_at)
                      : "—",
                  },
                  {
                    key: "cycle",
                    label: "当前周期",
                    children: subscription
                      ? when(subscription.current_cycle_start) +
                        " — " +
                        when(subscription.current_cycle_end)
                      : "—",
                  },
                  {
                    key: "billing",
                    label: "付费周期",
                    children: subscription
                      ? `${subscription.billing_amount} ${
                          subscription.billing_period === 2 ? "年" : "个月"
                        }`
                      : "—",
                  },
                ]}
                size="small"
              />
            </Card>
          </Col>
        ) : null}

        {canViewPlatformAccount ? (
          <Col lg={8} xs={24}>
            <Card title="积分余额">
              <Statistic title="可用积分" value={available} />
              <Progress
                aria-label={`积分使用率 ${Number(utilization.toFixed(1))}%`}
                percent={Number(utilization.toFixed(1))}
                status="active"
              />
              <Typography.Text type="secondary">
                已确认消耗 {(credits?.used_amount ?? 0).toLocaleString()}；官方
                total_amount 为当前可用量
              </Typography.Text>
            </Card>
          </Col>
        ) : null}

        <Col lg={canViewPlatformAccount ? 8 : 12} xs={24}>
          <Card title="所选周期">
            <Statistic
              title="积分消耗"
              value={breakdown?.total_credit_used ?? 0}
            />
            <Typography.Text type="secondary">
              {startDate} — {endDate}
            </Typography.Text>
            <Flex gap={4} style={{ marginTop: 12 }} wrap>
              {breakdown?.usages.slice(0, 3).map((item) => (
                <Tag key={item.quota_type}>
                  {quotaName(item.quota_type)} {item.percent.toFixed(0)}%
                </Tag>
              ))}
            </Flex>
          </Card>
        </Col>
        {!canViewPlatformAccount ? (
          <Col lg={12} xs={24}>
            <Card title="所选周期资源用量">
              <Statistic
                title="资源消耗量"
                value={breakdown?.total_quota_amount ?? 0}
              />
              <Typography.Text type="secondary">
                当前企业品牌范围
              </Typography.Text>
            </Card>
          </Col>
        ) : null}
      </Row>

      <Card
        extra={
          <Button
            disabled={!teamBindingId || !brandId}
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void loadOverview()}
            type="primary"
          >
            刷新计量
          </Button>
        }
        title="计量范围"
      >
        <Flex align="flex-end" gap={16} wrap>
          <div style={{ flex: "1 1 640px" }}>
            <ScopeFields organizations={organizations} scope={scope} />
          </div>
          <Flex style={{ flex: "0 1 300px" }} vertical>
            <Typography.Text type="secondary">统计周期</Typography.Text>
            <DatePicker.RangePicker
              allowClear={false}
              onChange={(values) => {
                if (!values?.[0] || !values[1]) return;
                setStartDate(values[0].format("YYYY-MM-DD"));
                setEndDate(values[1].format("YYYY-MM-DD"));
              }}
              value={[dayjs(startDate), dayjs(endDate)]}
            />
          </Flex>
          <Flex style={{ flex: "0 1 280px" }} vertical>
            <label htmlFor="metering-quota-type-filter">
              <Typography.Text type="secondary">用量类型</Typography.Text>
            </label>
            <Select
              allowClear
              id="metering-quota-type-filter"
              maxTagCount="responsive"
              mode="multiple"
              onChange={(values) => setQuotaTypes(values)}
              options={(usage?.plan.quotas ?? []).map((item) => ({
                label: quotaName(item.quota_type),
                value: item.quota_type,
              }))}
              placeholder="全部类型"
              value={quotaTypes}
            />
          </Flex>
        </Flex>
      </Card>

      {message || scope.error ? (
        <Alert
          closable
          message={message || scope.error}
          onClose={() => {
            setMessage("");
            scope.setError("");
          }}
          showIcon
          type="error"
        />
      ) : null}

      {successMessage ? (
        <Alert
          closable
          message={successMessage}
          onClose={() => setSuccessMessage("")}
          showIcon
          type="success"
        />
      ) : null}

      {canViewPlatformAccount ? (
        <Card title="积分批次明细">
          <AccessibleTable<Credits["credit_details"][number]>
            columns={[
              { title: "积分批次", dataIndex: "credit_id" },
              {
                title: "来源",
                dataIndex: "source_type",
                render: creditSourceName,
              },
              {
                title: "状态",
                dataIndex: "status",
                render: (value: number) => (
                  <Tag
                    color={
                      value === 1 ? "success" : value === 5 ? "gold" : undefined
                    }
                  >
                    {creditStatusName(value)}
                  </Tag>
                ),
              },
              {
                title: "当前可用",
                dataIndex: "total_amount",
                align: "right",
                render: (value: number) => value.toLocaleString(),
              },
              {
                title: "已确认消耗",
                dataIndex: "used_amount",
                align: "right",
                render: (value: number) => value.toLocaleString(),
              },
              {
                title: "到期时间",
                dataIndex: "expire_time",
                render: when,
              },
            ]}
            dataSource={credits?.credit_details ?? []}
            locale={{
              emptyText: (
                <Empty
                  description="暂无积分批次"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
            pagination={false}
            rowKey="credit_id"
            scroll={{ x: 820 }}
            scrollRegionLabel="积分批次明细，可横向滚动"
            size="small"
          />
        </Card>
      ) : null}

      <Row gutter={[16, 16]}>
        <Col lg={16} xs={24}>
          <Card
            extra={
              <Typography.Text type="secondary">
                {usage
                  ? when(usage.plan.valid_from) +
                    " — " +
                    when(usage.plan.valid_until)
                  : "—"}
              </Typography.Text>
            }
            title="当前周期配额"
          >
            {usage?.plan.quotas.length ? (
              <List
                dataSource={usage.plan.quotas}
                renderItem={(item) => {
                  const percent = item.total_amount
                    ? Math.min(
                        100,
                        (item.used_amount / item.total_amount) * 100,
                      )
                    : 0;
                  return (
                    <List.Item>
                      <div style={{ width: "100%" }}>
                        <Flex justify="space-between">
                          <Typography.Text strong>
                            {quotaName(item.quota_type)}
                          </Typography.Text>
                          <Typography.Text type="secondary">
                            {item.used_amount.toLocaleString()} /{" "}
                            {item.total_amount.toLocaleString()}
                          </Typography.Text>
                        </Flex>
                        <Progress
                          aria-label={`${quotaName(item.quota_type)}使用率 ${Number(percent.toFixed(1))}%`}
                          percent={Number(percent.toFixed(1))}
                        />
                        <Typography.Text type="secondary">
                          {when(item.reset_time)} 重置
                        </Typography.Text>
                      </div>
                    </List.Item>
                  );
                }}
              />
            ) : (
              <Empty
                description="暂无配额记录"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </Card>
        </Col>

        <Col lg={8} xs={24}>
          <Card title="品牌积分排行">
            <AccessibleTable<Rank>
              columns={rankColumns}
              dataSource={ranks.slice(0, 8)}
              locale={{
                emptyText: (
                  <Empty
                    description="暂无品牌消耗"
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              pagination={false}
              rowKey="brand_id"
              scrollRegionLabel="品牌积分排行，可横向滚动"
              size="small"
            />
          </Card>
        </Col>
      </Row>

      <Card
        extra={
          <Typography.Text type="secondary">
            {trends.length} 个数据点
          </Typography.Text>
        }
        title="积分消耗趋势"
      >
        <AccessibleTable<Trend>
          columns={trendColumns}
          dataSource={trends}
          locale={{
            emptyText: (
              <Empty
                description="暂无趋势数据"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          rowKey={(item) => item.date + "-" + item.quota_type}
          scroll={{ x: 640 }}
          scrollRegionLabel="积分消耗趋势，可横向滚动"
          size="small"
        />
      </Card>

      <Card
        extra={
          <Space wrap>
            {tab !== "overrides" ? (
              <Input.Search
                allowClear
                aria-label="搜索计量记录"
                onSearch={(value) => {
                  setRecordKeyword(value.trim());
                  setPage(1);
                }}
                placeholder="操作人或事件名称"
                style={{ width: 240 }}
              />
            ) : null}
            {tab === "bills" ? (
              <Select<BillStatus>
                aria-label="筛选积分流水状态"
                onChange={(value) => {
                  setBillStatus(value);
                  setPage(1);
                }}
                options={[
                  { label: "全部状态", value: 0 },
                  { label: "冻结中", value: 1 },
                  { label: "已确认", value: 2 },
                ]}
                style={{ width: 120 }}
                value={billStatus}
              />
            ) : null}
          </Space>
        }
        title="计量记录"
      >
        <Segmented<ListTab>
          block
          onChange={(value) => {
            setTab(value);
            setPage(1);
            setRecords([]);
          }}
          options={[
            { label: "积分流水", value: "bills" },
            ...(canViewPlatformAccount
              ? [
                  { label: "订阅日志", value: "logs" as const },
                  { label: "配额调整", value: "overrides" as const },
                ]
              : []),
          ]}
          style={{ marginBottom: 20 }}
          value={tab}
        />
        {records.length ? (
          <List
            dataSource={records}
            loading={recordsLoading}
            renderItem={(record, index) => (
              <List.Item key={recordKey(record, index)}>
                {"bill_id" in record ? (
                  <List.Item.Meta
                    description={
                      record.brand_name +
                      " · " +
                      record.operator_name +
                      " · " +
                      (record.is_pending ? "冻结中" : "已确认")
                    }
                    title={record.bill_type}
                  />
                ) : "log_id" in record ? (
                  <List.Item.Meta
                    description={record.message + " · " + record.operator_name}
                    title={record.action_text}
                  />
                ) : (
                  <List.Item.Meta
                    description={record.reason}
                    title={quotaName(record.quota_type)}
                  />
                )}
                <Space
                  direction="vertical"
                  size={0}
                  style={{ textAlign: "right" }}
                >
                  <Typography.Text strong>
                    {"bill_id" in record
                      ? (record.credit_change > 0 ? "+" : "") +
                        record.credit_change
                      : "log_id" in record
                        ? record.action
                        : record.quota_limit.toLocaleString()}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {when(
                      "created_time" in record
                        ? record.created_time
                        : record.created_at,
                    )}
                  </Typography.Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Empty
            description="暂无计量记录"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
        <Flex justify="flex-end" style={{ marginTop: 16 }}>
          <Pagination
            current={page}
            onChange={setPage}
            pageSize={20}
            showSizeChanger={false}
            total={recordTotal}
          />
        </Flex>
      </Card>
      {showCapacityExpansion ? (
        <Card
          title={
            <Space>
              <ExpandAltOutlined />
              用积分扩容 · 监控品牌
            </Space>
          }
        >
          <Row gutter={[20, 20]}>
            <Col lg={13} xs={24}>
              <Card size="small" title="当前容量">
                {capacityProjection ? (
                  <Space
                    direction="vertical"
                    size={16}
                    style={{ width: "100%" }}
                  >
                    <Row gutter={[12, 16]}>
                      <Col sm={8} xs={24}>
                        <Statistic
                          suffix="个"
                          title="容量上限"
                          value={capacityProjection.currentLimit}
                        />
                      </Col>
                      <Col sm={8} xs={12}>
                        <Statistic
                          suffix="个"
                          title="已创建品牌"
                          value={capacityProjection.createdCount}
                        />
                      </Col>
                      <Col sm={8} xs={12}>
                        <Statistic
                          suffix="个"
                          title="当前可用配额"
                          value={capacityProjection.availableCount}
                        />
                      </Col>
                    </Row>
                    <div>
                      <Flex justify="space-between" wrap>
                        <Typography.Text type="secondary">
                          品牌容量使用率
                        </Typography.Text>
                        <Typography.Text type="secondary">
                          {capacityProjection.createdCount.toLocaleString()} /{" "}
                          {capacityProjection.currentLimit.toLocaleString()}
                        </Typography.Text>
                      </Flex>
                      <Progress
                        aria-label={`品牌容量使用率 ${Number(capacityProjection.utilization.toFixed(1))}%`}
                        percent={Number(
                          capacityProjection.utilization.toFixed(1),
                        )}
                        status={
                          capacityProjection.availableCount === 0
                            ? "exception"
                            : "normal"
                        }
                      />
                    </div>
                  </Space>
                ) : loading ? (
                  <Skeleton active paragraph={{ rows: 2 }} title={false} />
                ) : (
                  <Alert
                    message="腾讯暂未返回监控品牌配额"
                    showIcon
                    type="warning"
                  />
                )}
              </Card>
            </Col>
            <Col lg={11} xs={24}>
              <Card size="small" title="扩容预估">
                <Flex gap={8} vertical>
                  <label htmlFor="metering-capacity-quantity">
                    <Typography.Text strong>扩容数量</Typography.Text>
                  </label>
                  <InputNumber
                    id="metering-capacity-quantity"
                    max={9999}
                    min={1}
                    onChange={(value) => setCapacityQuantity(value ?? 1)}
                    precision={0}
                    style={{ width: "100%" }}
                    value={capacityQuantity}
                  />
                  <Typography.Text type="secondary">
                    套餐不限增购数量（单次最多输入 9999）
                  </Typography.Text>
                </Flex>

                {capacityProjection ? (
                  <Descriptions
                    column={2}
                    items={[
                      {
                        key: "projected-limit",
                        label: "扩容后总容量",
                        children: `${capacityProjection.projectedLimit.toLocaleString()} 个`,
                      },
                      {
                        key: "projected-available",
                        label: "扩容后可用",
                        children: `${capacityProjection.projectedAvailableCount.toLocaleString()} 个`,
                      },
                    ]}
                    size="small"
                    style={{ marginTop: 16 }}
                  />
                ) : null}

                <Flex
                  align="center"
                  gap={16}
                  justify="flex-end"
                  style={{ marginTop: 16 }}
                  wrap
                >
                  <Popconfirm
                    cancelText="取消"
                    description={`将向腾讯提交扩容 ${capacityQuantity.toLocaleString()} 个，预计消耗 ${projectedCapacityCost.toLocaleString()} 积分。`}
                    okText="确认扩容"
                    onConfirm={() => purchaseCapacity()}
                    title="确认使用团队积分扩容？"
                  >
                    <Button
                      disabled={
                        !credits ||
                        !teamBindingId ||
                        projectedCapacityCost > available
                      }
                      loading={capacityPurchasing}
                      type="primary"
                    >
                      确认扩容
                    </Button>
                  </Popconfirm>
                </Flex>
              </Card>
            </Col>
          </Row>
        </Card>
      ) : null}
    </Space>
  );
}
