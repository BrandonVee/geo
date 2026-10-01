"use client";

import { ReloadOutlined, SwapOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Row,
  Select,
  Space,
  Statistic,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandAllocation } from "./brand-allocation";
import { AccessibleTable } from "../../accessible-table";
import {
  ScopeFields,
  scopeQuery,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";

type Asset = "answerbit_points" | "publication_cny";
type Account = {
  id: string;
  brandId: string | null;
  asset: Asset;
  balance: number;
};
type Transaction = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorUsername: string | null;
  asset: Asset;
  operation: string;
  amount: number;
  reason: string;
  createdAt: string;
};

const emptyTransactions: Transaction[] = [];

const money = (amount: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(amount / 100);

async function request<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败");
  return body.data as T;
}

export function BalanceManagementClient({
  organizations,
  userId,
}: {
  organizations: ScopeOrganization[];
  userId: string;
}) {
  const scope = useAnswerBitScope(organizations);
  const key = `${scope.organizationId}:${scope.teamBindingId}:${scope.brandId}`;
  const [snapshot, setSnapshot] = useState<{
    key: string;
    organization: Account[];
    brand: Account[];
    transactions: Transaction[];
  }>();
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const [transactionUserId, setTransactionUserId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    if (!scope.organizationId || !scope.teamBindingId || !scope.brandId) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setFailure(undefined);
    try {
      const brandQuery = scopeQuery({
        organizationId: scope.organizationId,
        teamBindingId: scope.teamBindingId,
        brandId: scope.brandId,
      });
      const [accounts, brand, transactions] = await Promise.all([
        request<Account[]>(
          `/api/v1/balances?organizationId=${scope.organizationId}`,
          { signal: controller.signal },
        ),
        request<Account[]>(`/api/v1/balances?${brandQuery}`, {
          signal: controller.signal,
        }),
        request<Transaction[]>(
          `/api/v1/balance-transactions?organizationId=${scope.organizationId}`,
          { signal: controller.signal },
        ),
      ]);
      if (controller.signal.aborted || controllerRef.current !== controller)
        return;
      setSnapshot({
        key,
        organization: accounts.filter((a) => a.brandId === null),
        brand,
        transactions,
      });
    } catch (reason) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setFailure({
          key,
          message: reason instanceof Error ? reason.message : "资产读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setLoading(false);
      }
    }
  }, [key, scope.brandId, scope.organizationId, scope.teamBindingId]);
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
  }, [load]);
  useEffect(() => setTransactionUserId(undefined), [scope.organizationId]);
  const readError = failure?.key === key ? failure.message : undefined;
  const data = !readError && snapshot?.key === key ? snapshot : undefined;
  const organizationAccounts = data?.organization ?? [],
    brandAccounts = data?.brand ?? [],
    transactions = data?.transactions ?? emptyTransactions;
  const reading = loading || (!data && !readError && !scope.error);
  const onAllocated = useCallback(
    async (success: string) => {
      setMessage(success);
      await load();
    },
    [load],
  );

  const transactionUsers = useMemo(
    () =>
      [
        ...new Map(
          transactions
            .filter((item) => item.actorUserId)
            .map((item) => [item.actorUserId!, item]),
        ).values(),
      ].map((item) => ({
        label: `${item.actorName ?? "未知用户"}${item.actorUsername ? ` (@${item.actorUsername})` : ""}`,
        value: item.actorUserId!,
      })),
    [transactions],
  );
  const visibleTransactions = transactionUserId
    ? transactions.filter((item) => item.actorUserId === transactionUserId)
    : transactions;

  const columns: TableColumnsType<Transaction> = [
    {
      title: "发生时间",
      dataIndex: "createdAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
    {
      title: "操作",
      dataIndex: "operation",
      width: 140,
      render: (value: string) =>
        ({
          grant: "平台入账",
          allocate: "企业向品牌划拨",
          consume: "业务消耗",
          restore: "失败返还",
          adjust: "人工调整",
        })[value] ?? value,
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
      title: "资产",
      dataIndex: "asset",
      width: 150,
      render: (value: Asset) =>
        value === "answerbit_points" ? "腾讯能力积分" : "发布人民币余额",
    },
    { title: "说明", dataIndex: "reason" },
    {
      title: "数量",
      dataIndex: "amount",
      align: "right",
      width: 140,
      render: (value: number, item) =>
        item.asset === "answerbit_points"
          ? value.toLocaleString()
          : money(value),
    },
  ];

  const pool = (targetAsset: Asset) =>
    organizationAccounts.find((item) => item.asset === targetAsset)?.balance ??
    0;
  const brand = (targetAsset: Asset) =>
    brandAccounts.find((item) => item.asset === targetAsset)?.balance ?? 0;

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Card title="管理范围">
        <ScopeFields organizations={organizations} scope={scope} />
      </Card>

      {message ? (
        <Alert
          closable
          message={message}
          onClose={() => {
            setMessage("");
          }}
          showIcon
          type="success"
        />
      ) : null}

      {readError ? (
        <Alert
          type="error"
          showIcon
          message="资产读取失败"
          description={readError}
          action={
            <Button disabled={loading} onClick={() => void load()}>
              重试读取资产
            </Button>
          }
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={reading}>
            <Statistic
              title="企业可分配积分"
              formatter={() =>
                data ? pool("answerbit_points").toLocaleString() : "—"
              }
              value={pool("answerbit_points")}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={reading}>
            <Statistic
              title="当前品牌积分"
              value={brand("answerbit_points")}
              formatter={() =>
                data ? brand("answerbit_points").toLocaleString() : "—"
              }
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={reading}>
            <Statistic
              formatter={() => (data ? money(pool("publication_cny")) : "—")}
              title="企业可分配发布余额"
              value={pool("publication_cny")}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={reading}>
            <Statistic
              formatter={() => (data ? money(brand("publication_cny")) : "—")}
              title="当前品牌发布余额"
              value={brand("publication_cny")}
            />
          </Card>
        </Col>
      </Row>

      <Row align="stretch" gutter={[16, 16]}>
        <Col lg={8} xs={24}>
          <Card
            title="企业资产划拨"
            extra={<SwapOutlined />}
            style={{ height: "100%" }}
          >
            <BrandAllocation
              userId={userId}
              organizationId={scope.organizationId}
              organizationName={
                organizations.find((o) => o.id === scope.organizationId)
                  ?.name ?? ""
              }
              brandId={scope.brandId}
              brandName={scope.brand?.name ?? ""}
              canAllocate={scope.can("balance.allocate")}
              pointsExpired={scope.pointsExpired}
              onAllocated={onAllocated}
            />
          </Card>
        </Col>
        <Col lg={16} xs={24}>
          <Card title="企业资产流水">
            <Flex gap={12} wrap style={{ marginBottom: 20 }}>
              <Select
                allowClear
                aria-label="按操作用户筛选资产流水"
                onChange={setTransactionUserId}
                options={transactionUsers}
                placeholder="全部用户"
                showSearch
                optionFilterProp="label"
                style={{ minWidth: 180, flex: "1 1 200px" }}
                value={transactionUserId}
              />
              <Button
                aria-label="刷新资产"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void load()}
              >
                刷新资产
              </Button>
            </Flex>
            <AccessibleTable<Transaction>
              loading={reading}
              columns={columns}
              dataSource={visibleTransactions}
              locale={{
                emptyText: (
                  <Empty
                    description={
                      <Typography.Text type="secondary">
                        {readError
                          ? "资产流水暂不可用，请重试读取"
                          : "暂无资产流水"}
                      </Typography.Text>
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ),
              }}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              rowKey="id"
              scroll={{ x: 860 }}
              scrollRegionLabel="企业资产流水，可横向滚动"
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
