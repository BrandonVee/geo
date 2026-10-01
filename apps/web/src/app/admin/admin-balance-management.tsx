"use client";

import {
  adminBalanceTransactionQuerySchema,
  type AdminBalanceTransactionQuery,
} from "@geo/contracts";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Row,
  Select,
  Space,
  Typography,
  type TableColumnsType,
} from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccessibleTable } from "../accessible-table";
import {
  AdminOrganizationDirectory,
  type AdminOrganization,
} from "./admin-organization-directory";

type Asset = "answerbit_points" | "publication_cny";
type OrganizationBalance = AdminOrganization & {
  balances: {
    enterprisePoints: number;
    enterprisePublicationCny: number;
    brandPoints: number;
    brandPublicationCny: number;
  };
};
type Transaction = {
  id: string;
  organizationId: string;
  organizationName: string;
  actorUserId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  asset: Asset;
  operation: "grant" | "allocate" | "consume" | "restore" | "adjust";
  amount: number;
  reason: string;
  referenceType: string;
  sourceBrandId: string | null;
  targetBrandId: string | null;
  createdAt: string;
};
type LedgerPage = {
  list: Transaction[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
const money = (value: number) => `¥${(value / 100).toFixed(2)}`;
const operationLabel = {
  grant: "平台入账",
  allocate: "品牌划拨",
  consume: "能力扣减",
  restore: "失败返还",
  adjust: "人工调整",
} as const;
const queryKeys = {
  organizationId: "ledgerOrganizationId",
  userId: "ledgerUserId",
  asset: "ledgerAsset",
  operation: "ledgerOperation",
  page: "ledgerPage",
  pageSize: "ledgerPageSize",
} as const;

function DirectorySelect({
  kind,
  value,
  label,
  onChange,
}: {
  kind: "enterprise" | "user";
  value?: string;
  label?: string;
  onChange: (value?: string, label?: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [q, setQ] = useState(""),
    [retry, setRetry] = useState(0);
  const [reading, setReading] = useState(false),
    [failure, setFailure] = useState("");
  const [options, setOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setReading(true);
    setFailure("");
    setOptions([]);
    setTotal(0);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ page: "1", pageSize: "20" });
        if (q.trim()) params.set("q", q.trim().slice(0, 200));
        const response = await fetch(
          `/api/v1/admin/${kind === "enterprise" ? "organization-balances" : "users"}?${params}`,
          { cache: "no-store", signal: controller.signal },
        );
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? "筛选目录读取失败");
        if (controller.signal.aborted) return;
        const rows = body.data.list as Array<{
          id: string;
          name: string;
          username?: string | null;
          answerbitBrandId?: string | null;
        }>;
        setOptions(
          rows.map((row) => ({
            value: row.id,
            label:
              kind === "enterprise"
                ? `${row.name}${row.answerbitBrandId ? `（${row.answerbitBrandId}）` : ""}`
                : `${row.name}${row.username ? ` (@${row.username})` : ""}`,
          })),
        );
        setTotal(body.data.pagination.total);
      } catch (reason) {
        if (!controller.signal.aborted)
          setFailure(
            reason instanceof Error ? reason.message : "筛选目录读取失败",
          );
      } finally {
        if (!controller.signal.aborted) setReading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [kind, open, q, retry]);
  const searchLabel =
    kind === "enterprise"
      ? "按企业筛选平台余额流水"
      : "按操作用户筛选平台余额流水";
  return (
    <Select<{ value: string; label: string }>
      allowClear
      showSearch
      labelInValue
      aria-label={searchLabel}
      value={value ? { value, label: label ?? value } : undefined}
      placeholder={kind === "enterprise" ? "全部企业" : "全部用户"}
      style={{ width: "100%", minWidth: 190 }}
      filterOption={false}
      options={options}
      loading={reading}
      onOpenChange={setOpen}
      onSearch={setQ}
      onChange={(selected) => onChange(selected?.value, selected?.label)}
      notFoundContent={
        failure ? (
          <Space direction="vertical">
            <Typography.Text type="danger">{failure}</Typography.Text>
            <Button
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRetry((n) => n + 1)}
            >
              重试筛选目录
            </Button>
          </Space>
        ) : (
          <Typography.Text type="secondary">
            {reading ? "正在读取" : "没有符合条件的结果"}
          </Typography.Text>
        )
      }
      popupRender={(menu) => (
        <>
          {menu}
          {total > 20 ? (
            <Typography.Paragraph
              type="secondary"
              style={{ margin: "8px 12px" }}
            >
              共 {total} 项，请输入名称
              {kind === "enterprise" ? "或 BrandID" : "或账号"}缩小范围
            </Typography.Paragraph>
          ) : null}
        </>
      )}
    />
  );
}

// @project-doc docs/architecture/platform_administration.md#asset_directory
export function AdminBalanceManagement({
  rules,
  refreshVersion,
  onAdjust,
  compact,
  mobile,
}: {
  rules: ReactNode;
  refreshVersion: number;
  onAdjust: (organization: AdminOrganization) => void;
  compact: boolean;
  mobile: boolean;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const serialized = search.toString();
  const [navigating, startTransition] = useTransition();
  const query = useMemo(() => {
    const params = new URLSearchParams(serialized);
    const parsed = adminBalanceTransactionQuerySchema.safeParse(
      Object.fromEntries(
        Object.entries(queryKeys)
          .filter(([, key]) => params.has(key))
          .map(([field, key]) => [field, params.get(key)]),
      ),
    );
    return parsed.success
      ? parsed.data
      : adminBalanceTransactionQuerySchema.parse({});
  }, [serialized]);
  const update = useCallback(
    (
      change: Partial<AdminBalanceTransactionQuery>,
      labels?: { organization?: string; user?: string },
    ) => {
      const params = new URLSearchParams(serialized),
        next = { ...query, ...change };
      for (const [field, key] of Object.entries(queryKeys)) {
        const value = next[field as keyof AdminBalanceTransactionQuery];
        if (value === undefined) params.delete(key);
        else params.set(key, String(value));
      }
      for (const [field, key] of [
        ["organization", "ledgerOrganizationLabel"],
        ["user", "ledgerUserLabel"],
      ] as const) {
        if (!next[field === "organization" ? "organizationId" : "userId"])
          params.delete(key);
        else if (labels && field in labels)
          params.set(key, labels[field] ?? "");
      }
      if (params.toString() !== serialized)
        startTransition(() =>
          router.replace(`${pathname}?${params}`, { scroll: false }),
        );
    },
    [pathname, query, router, serialized],
  );
  const url = `/api/v1/admin/balance-transactions?${new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([key, value]) => [key, String(value)]),
  )}`;
  const requestKey = `${url}:${refreshVersion}`;
  const [snapshot, setSnapshot] = useState<{ key: string; data: LedgerPage }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [reading, setReading] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setReading(true);
    setFailure(undefined);
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "平台流水读取失败");
      if (controller.signal.aborted || controllerRef.current !== controller)
        return;
      const data = body.data as LedgerPage;
      setSnapshot({ key: requestKey, data });
      if (data.pagination.page !== query.page)
        update({ page: data.pagination.page });
    } catch (reason) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setFailure({
          key: requestKey,
          message:
            reason instanceof Error ? reason.message : "平台流水读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setReading(false);
      }
    }
  }, [query.page, requestKey, update, url]);
  useEffect(() => {
    if (navigating) return;
    void refresh();
    const poll = () => {
      if (!document.hidden && navigator.onLine && !controllerRef.current)
        void refresh();
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
  }, [navigating, refresh]);
  const page =
    !navigating && snapshot?.key === requestKey ? snapshot.data : undefined;
  const error =
    !navigating && failure?.key === requestKey ? failure.message : undefined;
  const viewLedger = (organization: AdminOrganization) => {
    update(
      {
        organizationId: organization.id,
        userId: undefined,
        asset: undefined,
        operation: undefined,
        page: 1,
      },
      {
        organization: `${organization.name}（${organization.answerbitBrandId}）`,
      },
    );
    document
      .getElementById("admin-balance-ledger")
      ?.scrollIntoView({ block: "start" });
  };
  const columns: TableColumnsType<OrganizationBalance> = [
    {
      title: "企业与品牌",
      width: 230,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text strong>{row.name}</Typography.Text>
          <Typography.Text type="secondary">
            {row.answerbitBrandId}
          </Typography.Text>
          <Badge
            status={row.accessState === "active" ? "success" : "warning"}
            text={
              row.accessState === "expired"
                ? "到期冻结"
                : row.accessState === "suspended"
                  ? "手动冻结"
                  : "正常"
            }
          />
          {row.pointsExpired ? (
            <Typography.Text type="warning">积分已到期</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "企业资金池",
      width: 165,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text>
            {row.balances.enterprisePoints.toLocaleString()} 积分
          </Typography.Text>
          <Typography.Text type="secondary">
            {money(row.balances.enterprisePublicationCny)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "品牌账户",
      width: 165,
      render: (_, row) => (
        <Space direction="vertical" size={4}>
          <Typography.Text>
            {row.balances.brandPoints.toLocaleString()} 积分
          </Typography.Text>
          <Typography.Text type="secondary">
            {money(row.balances.brandPublicationCny)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "操作",
      width: 150,
      render: (_, row) => (
        <Space direction="vertical" size={8}>
          <Button type="primary" onClick={() => onAdjust(row)}>
            入账 / 扣减
          </Button>
          <Button onClick={() => viewLedger(row)}>查看流水</Button>
        </Space>
      ),
    },
  ];
  const ledgerColumns: TableColumnsType<Transaction> = [
    {
      title: "发生时间",
      dataIndex: "createdAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    { title: "企业", dataIndex: "organizationName", width: 180 },
    {
      title: "账户",
      width: 190,
      render: (_, row) => {
        const account = (brand: string | null) =>
          brand ? `品牌 ${brand}` : "企业资金池";
        return row.operation === "allocate"
          ? `${account(row.sourceBrandId)} → ${account(row.targetBrandId)}`
          : account(
              row.operation === "consume" ||
                row.referenceType === "admin_deduction"
                ? row.sourceBrandId
                : row.targetBrandId,
            );
      },
    },
    {
      title: "操作用户",
      width: 180,
      render: (_, row) =>
        row.actorUserId ? (
          <Space direction="vertical" size={0}>
            <Typography.Text>{row.actorName ?? "未知用户"}</Typography.Text>
            {row.actorUsername ? (
              <Typography.Text type="secondary">
                @{row.actorUsername}
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
      render: (value: Transaction["operation"]) => operationLabel[value],
    },
    {
      title: "资产",
      dataIndex: "asset",
      width: 130,
      render: (value: Asset) =>
        value === "answerbit_points" ? "腾讯能力积分" : "发布人民币",
    },
    { title: "说明", dataIndex: "reason", width: 220 },
    {
      title: "数量",
      align: "right",
      width: 120,
      render: (_, row) => {
        const minus =
            row.operation === "consume" ||
            row.referenceType === "admin_deduction",
          plus = row.operation === "grant" || row.operation === "restore";
        return (
          <Typography.Text
            type={minus ? "danger" : plus ? "success" : undefined}
          >
            {minus ? "−" : plus ? "+" : ""}
            {row.asset === "answerbit_points"
              ? row.amount.toLocaleString()
              : money(row.amount)}
          </Typography.Text>
        );
      },
    },
  ];
  const params = new URLSearchParams(serialized);
  return (
    <Row gutter={[16, 16]}>
      <Col xl={14} xs={24}>
        <Card title="企业资产">
          <AdminOrganizationDirectory<OrganizationBalance>
            columns={columns}
            refreshVersion={refreshVersion}
            compact={compact}
            mobile={mobile}
            endpoint="/api/v1/admin/organization-balances"
            queryPrefix="fund"
            scrollWidth={710}
          />
        </Card>
      </Col>
      <Col xl={10} xs={24}>
        {rules}
      </Col>
      <Col span={24}>
        <Card title="用户积分与余额流水" id="admin-balance-ledger">
          <Space direction="vertical" size={20} style={{ width: "100%" }}>
            <Flex gap={12} wrap>
              <div style={{ flex: "1 1 220px" }}>
                <DirectorySelect
                  kind="enterprise"
                  value={query.organizationId}
                  label={params.get("ledgerOrganizationLabel") ?? undefined}
                  onChange={(id, label) =>
                    update(
                      { organizationId: id, page: 1 },
                      { organization: label },
                    )
                  }
                />
              </div>
              <div style={{ flex: "1 1 220px" }}>
                <DirectorySelect
                  kind="user"
                  value={query.userId}
                  label={params.get("ledgerUserLabel") ?? undefined}
                  onChange={(id, label) =>
                    update({ userId: id, page: 1 }, { user: label })
                  }
                />
              </div>
              <Select
                aria-label="按资产筛选平台余额流水"
                value={query.asset ?? "all"}
                options={[
                  { label: "全部资产", value: "all" },
                  { label: "腾讯能力积分", value: "answerbit_points" },
                  { label: "发布人民币", value: "publication_cny" },
                ]}
                style={{ width: 160 }}
                onChange={(value) =>
                  update({
                    asset: value === "all" ? undefined : (value as Asset),
                    page: 1,
                  })
                }
              />
              <Select
                aria-label="按操作类型筛选平台余额流水"
                value={query.operation ?? "all"}
                options={[
                  { label: "全部操作", value: "all" },
                  ...Object.entries(operationLabel).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
                style={{ width: 140 }}
                onChange={(value) =>
                  update({
                    operation:
                      value === "all"
                        ? undefined
                        : (value as Transaction["operation"]),
                    page: 1,
                  })
                }
              />
              {query.organizationId ||
              query.userId ||
              query.asset ||
              query.operation ? (
                <Button
                  onClick={() =>
                    update({
                      organizationId: undefined,
                      userId: undefined,
                      asset: undefined,
                      operation: undefined,
                      page: 1,
                    })
                  }
                >
                  重置流水筛选
                </Button>
              ) : null}
            </Flex>
            {error ? (
              <Alert
                type="error"
                showIcon
                message="平台流水读取失败"
                description={error}
                action={
                  <Button disabled={reading} onClick={() => void refresh()}>
                    重试读取平台流水
                  </Button>
                }
              />
            ) : null}
            <AccessibleTable<Transaction>
              columns={ledgerColumns}
              dataSource={page?.list ?? []}
              rowKey="id"
              scroll={{ x: 1310 }}
              scrollRegionLabel="平台余额流水，可横向滚动"
              loading={navigating || reading || (!page && !error)}
              pagination={{
                current: page?.pagination.page ?? query.page,
                pageSize: query.pageSize,
                total: page?.pagination.total ?? 0,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 条资产流水`,
              }}
              onChange={(pagination) =>
                update({
                  page:
                    pagination.pageSize !== query.pageSize
                      ? 1
                      : (pagination.current ?? 1),
                  pageSize: pagination.pageSize ?? 20,
                })
              }
              locale={{
                emptyText: error ? (
                  <Typography.Text type="secondary">
                    平台流水暂不可用，请重试读取
                  </Typography.Text>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      <Typography.Text type="secondary">
                        暂无符合条件的资产流水
                      </Typography.Text>
                    }
                  />
                ),
              }}
            />
          </Space>
        </Card>
      </Col>
    </Row>
  );
}
