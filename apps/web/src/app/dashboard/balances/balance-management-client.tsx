"use client";

import { ReloadOutlined, SwapOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
type AllocationForm = { asset: Asset; amount: number; reason: string };

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
}: {
  organizations: ScopeOrganization[];
}) {
  const scope = useAnswerBitScope(organizations);
  const [organizationAccounts, setOrganizationAccounts] = useState<Account[]>(
    [],
  );
  const [brandAccounts, setBrandAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionUserId, setTransactionUserId] = useState<string>();
  const [asset, setAsset] = useState<Asset>("answerbit_points");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [form] = Form.useForm<AllocationForm>();
  const requestVersion = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!scope.organizationId || !scope.teamBindingId || !scope.brandId)
        return;
      const version = ++requestVersion.current;
      setLoading(true);
      try {
        const brandQuery = scopeQuery({
          organizationId: scope.organizationId,
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
        });
        const [accounts, brand, ledger] = await Promise.all([
          request<Account[]>(
            `/api/v1/balances?organizationId=${scope.organizationId}`,
            { signal },
          ),
          request<Account[]>(`/api/v1/balances?${brandQuery}`, { signal }),
          request<Transaction[]>(
            `/api/v1/balance-transactions?organizationId=${scope.organizationId}`,
            { signal },
          ),
        ]);
        if (signal?.aborted || version !== requestVersion.current) return;
        setOrganizationAccounts(
          accounts.filter((account) => account.brandId === null),
        );
        setBrandAccounts(brand);
        setTransactions(ledger);
      } catch (error) {
        if (!signal?.aborted && version === requestVersion.current)
          setMessage(error instanceof Error ? error.message : "资产加载失败");
      } finally {
        if (!signal?.aborted && version === requestVersion.current)
          setLoading(false);
      }
    },
    [scope.brandId, scope.organizationId, scope.teamBindingId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => setTransactionUserId(undefined), [scope.organizationId]);

  async function allocate(values: AllocationForm) {
    setSubmitting(true);
    try {
      await request("/api/v1/balance-allocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: scope.organizationId,
          brandId: scope.brandId,
          asset: values.asset,
          amount:
            values.asset === "publication_cny"
              ? Math.round(values.amount * 100)
              : values.amount,
          reason: values.reason,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      form.resetFields();
      form.setFieldValue("asset", asset);
      await load();
      setMessage("企业资产已划拨到当前品牌");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "资产划拨失败");
    } finally {
      setSubmitting(false);
    }
  }

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
    { title: "操作", dataIndex: "operation", width: 140 },
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

      {message || scope.error ? (
        <Alert
          closable
          message={message || scope.error}
          onClose={() => {
            setMessage("");
            scope.setError("");
          }}
          showIcon
          type={scope.error ? "error" : "info"}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={loading}>
            <Statistic
              title="企业可分配积分"
              value={pool("answerbit_points")}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={loading}>
            <Statistic title="当前品牌积分" value={brand("answerbit_points")} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={loading}>
            <Statistic
              formatter={() => money(pool("publication_cny"))}
              title="企业可分配发布余额"
              value={pool("publication_cny")}
            />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card loading={loading}>
            <Statistic
              formatter={() => money(brand("publication_cny"))}
              title="当前品牌发布余额"
              value={brand("publication_cny")}
            />
          </Card>
        </Col>
      </Row>

      <Row align="stretch" gutter={[16, 16]}>
        <Col lg={8} xs={24}>
          <Card
            title="划拨到当前品牌"
            extra={<SwapOutlined />}
            style={{ height: "100%" }}
          >
            <Alert
              message="这是企业资产管理操作，仅企业管理员可用。划拨后由当前品牌的业务功能或发布订单消费。"
              showIcon
              style={{ marginBottom: 20 }}
              type="info"
            />
            <Form<AllocationForm>
              form={form}
              initialValues={{ asset: "answerbit_points" }}
              layout="vertical"
              onFinish={(values) => void allocate(values)}
            >
              <Form.Item
                label="资产类型"
                name="asset"
                rules={[{ required: true, message: "请选择资产类型" }]}
              >
                <Select
                  onChange={(value: Asset) => setAsset(value)}
                  options={[
                    { label: "腾讯能力积分", value: "answerbit_points" },
                    { label: "发布人民币余额（元）", value: "publication_cny" },
                  ]}
                />
              </Form.Item>
              <Form.Item
                label="划拨数量"
                name="amount"
                rules={[{ required: true, message: "请输入划拨数量" }]}
              >
                <InputNumber
                  min={asset === "publication_cny" ? 0.01 : 1}
                  precision={asset === "publication_cny" ? 2 : 0}
                  step={asset === "publication_cny" ? 0.01 : 1}
                  style={{ width: "100%" }}
                />
              </Form.Item>
              <Form.Item
                label="划拨说明"
                name="reason"
                rules={[
                  { required: true, message: "请输入划拨说明" },
                  { min: 4, message: "至少输入 4 个字符" },
                ]}
              >
                <Input placeholder="说明本次划拨用途" />
              </Form.Item>
              <Button
                block
                disabled={!scope.brandId}
                htmlType="submit"
                loading={submitting}
                type="primary"
              >
                确认划拨
              </Button>
            </Form>
          </Card>
        </Col>
        <Col lg={16} xs={24}>
          <Card
            extra={
              <Space>
                <Select
                  allowClear
                  aria-label="按操作用户筛选资产流水"
                  onChange={setTransactionUserId}
                  options={transactionUsers}
                  placeholder="全部用户"
                  showSearch
                  style={{ minWidth: 200 }}
                  value={transactionUserId}
                />
                <Button
                  icon={<ReloadOutlined />}
                  loading={loading}
                  onClick={() => void load()}
                >
                  刷新
                </Button>
              </Space>
            }
            title="企业资产流水"
          >
            <AccessibleTable<Transaction>
              columns={columns}
              dataSource={visibleTransactions}
              locale={{
                emptyText: (
                  <Empty
                    description="暂无资产流水"
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
