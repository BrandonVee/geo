"use client";

import { ReloadOutlined } from "@ant-design/icons";
import {
  balanceTransactionQuerySchema,
  type BalanceTransactionQuery,
} from "@geo/contracts";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  Select,
  Space,
  Typography,
  type TableColumnsType,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccessibleTable } from "../../accessible-table";

type Transaction = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  asset: "answerbit_points" | "publication_cny";
  operation: "grant" | "allocate" | "consume" | "restore" | "adjust";
  amount: number;
  reason: string;
  sourceAccountId: string | null;
  targetAccountId: string | null;
  sourceBrandId: string | null;
  targetBrandId: string | null;
  sourceBrandName: string | null;
  targetBrandName: string | null;
  createdAt: string;
};
type LedgerPage = {
  list: Transaction[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
type Actor = { id: string; name: string; username: string | null };
const operationLabels = {
  grant: "平台入账",
  allocate: "企业向品牌划拨",
  consume: "业务消耗",
  restore: "失败返还",
  adjust: "人工调整",
};
const queryKeys = {
  userId: "ledgerUserId",
  asset: "ledgerAsset",
  operation: "ledgerOperation",
  beginDate: "ledgerBeginDate",
  endDate: "ledgerEndDate",
  page: "ledgerPage",
  pageSize: "ledgerPageSize",
} as const;
const actorLabel = (actor: Actor) =>
  `${actor.name}${actor.username ? ` (@${actor.username})` : ""}`;
async function request<T>(url: string, signal: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "资产流水读取失败");
  return body.data as T;
}

function LedgerActorSelect({
  organizationId,
  value,
  onChange,
}: {
  organizationId: string;
  value?: string;
  onChange: (value?: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [retry, setRetry] = useState(0);
  const [state, setState] = useState<{
    key: string;
    list: Actor[];
    error?: string;
  }>();
  const [selected, setSelected] = useState<Actor>();
  const [reading, setReading] = useState(false);
  const key = `${organizationId}:${q}`;
  useEffect(() => {
    if (!value) {
      setSelected(undefined);
      return;
    }
    const controller = new AbortController();
    void request<Actor[]>(
      `/api/v1/balance-transactions/actors?${new URLSearchParams({ organizationId, userId: value })}`,
      controller.signal,
    )
      .then((actors) => {
        if (!controller.signal.aborted) setSelected(actors[0]);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSelected(undefined);
      });
    return () => controller.abort();
  }, [organizationId, value, retry]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setReading(true);
    const timer = window.setTimeout(async () => {
      try {
        const list = await request<Actor[]>(
          `/api/v1/balance-transactions/actors?${new URLSearchParams({ organizationId, q: q.trim().slice(0, 200) })}`,
          controller.signal,
        );
        if (!controller.signal.aborted) setState({ key, list });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            key,
            list: [],
            error: error instanceof Error ? error.message : "操作者读取失败",
          });
      } finally {
        if (!controller.signal.aborted) setReading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [organizationId, open, q, retry, key]);
  const current = state?.key === key ? state : undefined;
  return (
    <Select<{ value: string; label: string }>
      allowClear
      showSearch
      labelInValue
      filterOption={false}
      aria-label="按操作用户筛选资产流水"
      placeholder="全部用户"
      style={{ minWidth: 180, flex: "1 1 200px" }}
      value={
        value
          ? {
              value,
              label: selected?.id === value ? actorLabel(selected) : value,
            }
          : undefined
      }
      options={(current?.list ?? []).map((actor) => ({
        value: actor.id,
        label: actorLabel(actor),
      }))}
      loading={reading}
      onOpenChange={setOpen}
      onSearch={setQ}
      onChange={(item) => onChange(item?.value)}
      notFoundContent={
        current?.error ? (
          <Space direction="vertical">
            <Typography.Text type="danger">{current.error}</Typography.Text>
            <Button
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRetry((n) => n + 1)}
            >
              重试操作者读取
            </Button>
          </Space>
        ) : reading ? (
          "正在读取…"
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有匹配的流水操作者"
          />
        )
      }
      popupRender={(menu) => (
        <>
          {menu}
          <Typography.Paragraph type="secondary" style={{ margin: 8 }}>
            可搜索姓名或账号，最多显示 20 位
          </Typography.Paragraph>
        </>
      )}
    />
  );
}

export function EnterpriseLedger({
  organizationId,
  brandId,
  refreshVersion,
  onRefreshAssets,
}: {
  organizationId: string;
  brandId: string;
  refreshVersion: number;
  onRefreshAssets: () => void;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const [navigating, startTransition] = useTransition();
  const raw: Record<string, string> = { organizationId };
  if (search.get("ledgerOrganizationId") === organizationId)
    for (const [field, key] of Object.entries(queryKeys)) {
      const value = search.get(key);
      if (value) raw[field] = value;
    }
  const parsed = balanceTransactionQuerySchema.safeParse(raw);
  const filters = parsed.success
    ? parsed.data
    : balanceTransactionQuerySchema.parse({ organizationId });
  const params = new URLSearchParams(
    Object.entries(filters).map(([key, value]) => [key, String(value)]),
  );
  const url = `/api/v1/balance-transactions?${params}`;
  const [snapshot, setSnapshot] = useState<{ url: string; data: LedgerPage }>();
  const [failure, setFailure] = useState<{ url: string; message: string }>();
  const [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setFailure(undefined);
    try {
      const data = await request<LedgerPage>(url, controller.signal);
      if (!controller.signal.aborted && controllerRef.current === controller)
        setSnapshot({ url, data });
    } catch (error) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setFailure({
          url,
          message: error instanceof Error ? error.message : "资产流水读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setLoading(false);
      }
    }
  }, [url]);
  useEffect(() => {
    void load();
    const poll = () => {
      if (!document.hidden && navigator.onLine && !controllerRef.current)
        void load();
    };
    const timer = window.setInterval(poll, 60_000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("online", poll);
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("online", poll);
    };
  }, [load, refreshVersion, retry]);
  const error = failure?.url === url ? failure.message : undefined;
  const data = !error && snapshot?.url === url ? snapshot.data : undefined;
  const change = (patch: Partial<BalanceTransactionQuery>) => {
    const next = { ...filters, page: 1, ...patch };
    const nextParams = new URLSearchParams(search);
    nextParams.set("organizationId", organizationId);
    if (brandId) nextParams.set("brandId", brandId);
    nextParams.set("ledgerOrganizationId", organizationId);
    for (const [field, key] of Object.entries(queryKeys)) {
      const value = next[field as keyof typeof queryKeys];
      if (value !== undefined) nextParams.set(key, String(value));
      else nextParams.delete(key);
    }
    startTransition(() =>
      router.replace(`${pathname}?${nextParams}`, { scroll: false }),
    );
  };
  const account = (
    id: string | null,
    name: string | null,
    accountId: string | null,
  ) =>
    accountId ? (
      id ? (
        <Space direction="vertical" size={0}>
          <Typography.Text>{name ?? "品牌账户"}</Typography.Text>
          <Typography.Text type="secondary">{id}</Typography.Text>
        </Space>
      ) : (
        "企业资金池"
      )
    ) : (
      "—"
    );
  const columns: TableColumnsType<Transaction> = [
    {
      title: "发生时间（北京时间）",
      dataIndex: "createdAt",
      width: 180,
      render: (value: string) =>
        new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    },
    {
      title: "操作",
      dataIndex: "operation",
      width: 140,
      render: (value: Transaction["operation"]) => operationLabels[value],
    },
    {
      title: "操作用户",
      key: "actor",
      width: 180,
      render: (_, item) =>
        item.actorUserId ? (
          <Space direction="vertical" size={0}>
            <Typography.Text>{item.actorName ?? "未知用户"}</Typography.Text>
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
      title: "来源账户",
      key: "source",
      width: 180,
      render: (_, item) =>
        account(item.sourceBrandId, item.sourceBrandName, item.sourceAccountId),
    },
    {
      title: "目标账户",
      key: "target",
      width: 180,
      render: (_, item) =>
        account(item.targetBrandId, item.targetBrandName, item.targetAccountId),
    },
    {
      title: "资产",
      dataIndex: "asset",
      width: 150,
      render: (value: Transaction["asset"]) =>
        value === "answerbit_points" ? "腾讯能力积分" : "发布人民币余额",
    },
    { title: "说明", dataIndex: "reason", width: 220 },
    {
      title: "数量",
      dataIndex: "amount",
      align: "right",
      width: 140,
      render: (value: number, item) => (
        <Typography.Text>
          {item.operation === "consume" ||
          (item.operation === "adjust" &&
            item.sourceAccountId &&
            !item.targetAccountId)
            ? "−"
            : item.operation === "grant" ||
                item.operation === "restore" ||
                (item.operation === "adjust" &&
                  item.targetAccountId &&
                  !item.sourceAccountId)
              ? "+"
              : ""}
          {item.asset === "answerbit_points"
            ? value.toLocaleString()
            : `¥${(value / 100).toFixed(2)}`}
        </Typography.Text>
      ),
    },
  ];
  return (
    <Card title="企业资产流水">
      {!parsed.success ? (
        <Alert
          type="warning"
          showIcon
          message="流水筛选参数无效，请重新选择筛选条件"
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Flex gap={12} wrap style={{ marginBottom: 20 }}>
        <LedgerActorSelect
          key={organizationId}
          organizationId={organizationId}
          value={filters.userId}
          onChange={(userId) => change({ userId })}
        />
        <Select
          aria-label="按资产筛选企业流水"
          allowClear
          value={filters.asset}
          onChange={(asset) => change({ asset })}
          placeholder="全部资产"
          style={{ minWidth: 160, flex: "1 1 160px" }}
          options={[
            { value: "answerbit_points", label: "腾讯能力积分" },
            { value: "publication_cny", label: "发布人民币余额" },
          ]}
        />
        <Select
          aria-label="按操作类型筛选企业流水"
          allowClear
          value={filters.operation}
          onChange={(operation) => change({ operation })}
          placeholder="全部操作"
          style={{ minWidth: 170, flex: "1 1 170px" }}
          options={Object.entries(operationLabels).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Flex vertical style={{ minWidth: 0, flex: "1 1 280px" }}>
          <label htmlFor="ledger-begin">流水日期（北京时间）</label>
          <label
            htmlFor="ledger-end"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0, 0, 0, 0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          >
            流水结束日期
          </label>
          <DatePicker.RangePicker
            id={{ start: "ledger-begin", end: "ledger-end" }}
            allowEmpty={[true, true]}
            placeholder={["开始日期", "结束日期"]}
            value={
              filters.beginDate || filters.endDate
                ? [
                    filters.beginDate ? dayjs(filters.beginDate) : null,
                    filters.endDate ? dayjs(filters.endDate) : null,
                  ]
                : null
            }
            onChange={(dates) =>
              change({
                beginDate: dates?.[0]?.format("YYYY-MM-DD"),
                endDate: dates?.[1]?.format("YYYY-MM-DD"),
              })
            }
            style={{ width: "100%" }}
          />
        </Flex>
        <Button
          disabled={navigating}
          onClick={() =>
            change({
              userId: undefined,
              asset: undefined,
              operation: undefined,
              beginDate: undefined,
              endDate: undefined,
              page: 1,
            })
          }
        >
          清除流水筛选
        </Button>
        <Button
          aria-label="刷新资产"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => {
            void load();
            onRefreshAssets();
          }}
        >
          刷新资产
        </Button>
      </Flex>
      {error ? (
        <Alert
          type="error"
          showIcon
          message="资产流水读取失败"
          description={error}
          action={
            <Button onClick={() => setRetry((n) => n + 1)} disabled={loading}>
              重试读取流水
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <AccessibleTable<Transaction>
        rowKey="id"
        columns={columns}
        loading={loading || navigating || (!data && !error)}
        dataSource={data?.list ?? []}
        scroll={{ x: 1370 }}
        scrollRegionLabel="企业资产流水，可横向滚动"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Typography.Text type="secondary">
                  {error
                    ? "资产流水暂不可用，请重试读取"
                    : "暂无符合条件的资产流水"}
                </Typography.Text>
              }
            />
          ),
        }}
        pagination={{
          current: data?.pagination.page ?? filters.page,
          pageSize: filters.pageSize,
          total: data?.pagination.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `共 ${total} 条资产流水`,
          onChange: (page, pageSize) =>
            change({
              page: pageSize === filters.pageSize ? page : 1,
              pageSize,
            }),
        }}
      />
    </Card>
  );
}
