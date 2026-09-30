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

const number = new Intl.NumberFormat("zh-CN");
const defaultRange = (): [Dayjs, Dayjs] => [
  dayjs().subtract(29, "day").startOf("day"),
  dayjs().startOf("day"),
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
  const scope = useAnswerBitScope(organizations);
  const { token } = theme.useToken();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"organization" | "brand">(() =>
    searchParams.get("brandId") ? "brand" : "organization",
  );
  const canViewOrganization =
    organizations.find((item) => item.id === scope.organizationId)?.role ===
    "tenant_admin";
  const enterpriseView = canViewOrganization && view === "organization";

  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange);
  const [operation, setOperation] = useState<"all" | UsageOperation>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [result, setResult] = useState<{
    key: string;
    data: PointUsage;
  } | null>(null);
  const dataKey = JSON.stringify([
    scope.organizationId,
    enterpriseView ? null : scope.brandId,
    range.map((value) => value.format("YYYY-MM-DD")),
    operation,
    page,
    pageSize,
  ]);
  const data = result?.key === dataKey ? result.data : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const version = ++requestVersion.current;
      if (
        !scope.organizationId ||
        (!enterpriseView && (!scope.teamBindingId || !scope.brandId))
      ) {
        setResult(null);
        setLoading(false);
        setError("");
        return;
      }
      setLoading(true);
      setError("");
      const params = new URLSearchParams({
        organizationId: scope.organizationId,
      });
      if (!enterpriseView) {
        params.set("teamBindingId", scope.teamBindingId);
        params.set("brandId", scope.brandId);
      }
      params.set("beginDate", range[0].format("YYYY-MM-DD"));
      params.set("endDate", range[1].format("YYYY-MM-DD"));
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      if (operation !== "all") params.set("operation", operation);
      try {
        const next = await request<PointUsage>(
          `/api/v1/point-usage?${params.toString()}`,
          signal,
        );
        if (!signal?.aborted && version === requestVersion.current)
          setResult({ key: dataKey, data: next });
      } catch (reason) {
        if (!signal?.aborted && version === requestVersion.current)
          setError(
            reason instanceof Error ? reason.message : "积分用量加载失败",
          );
      } finally {
        if (!signal?.aborted && version === requestVersion.current)
          setLoading(false);
      }
    },
    [
      dataKey,
      enterpriseView,
      operation,
      page,
      pageSize,
      range,
      scope.brandId,
      scope.organizationId,
      scope.teamBindingId,
    ],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      requestVersion.current += 1;
    };
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [operation, range, scope.brandId, scope.organizationId, enterpriseView]);

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
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
          >
            刷新数据
          </Button>
        }
      >
        {canViewOrganization ? (
          <Segmented
            aria-label="积分统计范围"
            value={view}
            onChange={(value) => setView(value as "organization" | "brand")}
            options={[
              { label: "企业整体", value: "organization" },
              { label: "当前品牌", value: "brand" },
            ]}
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
              allowClear={false}
              disabledDate={(current) => current.isAfter(dayjs(), "day")}
              id="point-usage-date-range"
              onChange={(value) => {
                if (value?.[0] && value[1]) setRange([value[0], value[1]]);
              }}
              presets={[
                {
                  label: "近 7 天",
                  value: [dayjs().subtract(6, "day"), dayjs()],
                },
                { label: "近 30 天", value: defaultRange() },
                {
                  label: "近 90 天",
                  value: [dayjs().subtract(89, "day"), dayjs()],
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
            <Select
              id="point-usage-operation"
              onChange={setOperation}
              options={[...operationOptions]}
              value={operation}
            />
          </Flex>
        </Flex>

        {error || scope.error ? (
          <Alert
            closable
            message={error || scope.error}
            onClose={() => {
              setError("");
              scope.setError("");
            }}
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
            当前筛选共 {number.format(data?.pagination.total ?? 0)} 条
          </Typography.Text>
        </Flex>
        <AccessibleTable<UsageTransaction>
          columns={columns}
          dataSource={data?.list ?? []}
          loading={loading}
          locale={{
            emptyText: (
              <Empty
                description="当前范围内暂无积分消耗记录"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
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
            showTotal: (total) => `共 ${total} 条`,
            total: data?.pagination.total ?? 0,
          }}
          rowKey="id"
          scroll={{ x: 920 }}
          scrollRegionLabel="积分消耗明细，可横向滚动"
        />
      </Card>
    </Space>
  );
}
