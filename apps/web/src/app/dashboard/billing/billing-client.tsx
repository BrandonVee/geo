"use client";

import { ReloadOutlined, SendOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
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

import { PublicationAttempt } from "./publication-attempt";
import {
  PublicationChannelPicker,
  type PublicationChannel,
  type PublicationChannelQuery,
} from "./publication-channel-picker";

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
type Channel = PublicationChannel;
type PublicationOrder = {
  order: {
    id: string;
    title: string;
    status: string;
    priceAmount: number;
    currency: string;
    resultUrl: string | null;
    providerOrderId: string | null;
    providerStatus: number | null;
    providerMessage: string | null;
    createdAt: string;
  };
  channel: Channel;
};
type AllocationForm = { asset: Asset; amount: number; reason: string };
type PublicationForm = {
  channelId: string;
  title: string;
  contentUrl?: string;
  contentHtml?: string;
  note?: string;
};
type AppealForm = { reason: 1 | 2 | 3 | 4; detail?: string };
type PageData<T> = {
  list: T[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};

const money = (amount: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    amount / 100,
  );
async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败");
  return body.data as T;
}
type BillingProps = {
  organizations: ScopeOrganization[];
  initialPublication: {
    title: string;
    sourceJobId?: string;
    sourceDocumentId?: string;
    note: string;
  };
};
export function BillingClient(props: BillingProps) {
  const scope = useAnswerBitScope(props.organizations);
  return (
    <BillingWorkspace
      key={`${scope.organizationId}:${scope.teamBindingId}:${scope.brandId}`}
      {...props}
      scope={scope}
    />
  );
}
function BillingWorkspace({
  organizations,
  initialPublication,
  scope,
}: BillingProps & { scope: ReturnType<typeof useAnswerBitScope> }) {
  const [sourceJobId, setSourceJobId] = useState(
    initialPublication.sourceJobId,
  );
  const [sourceDocumentId, setSourceDocumentId] = useState(
    initialPublication.sourceDocumentId,
  );
  const attempt = useRef(new PublicationAttempt());
  const submitting = useRef(false);
  const readVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const [brandAccounts, setBrandAccounts] = useState<Account[]>([]);
  const [organizationAccounts, setOrganizationAccounts] = useState<Account[]>(
    [],
  );
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionUserId, setTransactionUserId] = useState<string>();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelTotal, setChannelTotal] = useState(0);
  const [channelLoading, setChannelLoading] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<Channel>();
  const [orders, setOrders] = useState<PublicationOrder[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [allocationAsset, setAllocationAsset] =
    useState<Asset>("answerbit_points");
  const [allocationForm] = Form.useForm<AllocationForm>();
  const [publicationForm] = Form.useForm<PublicationForm>();
  const [appealForm] = Form.useForm<AppealForm>();
  const [appealOrderId, setAppealOrderId] = useState<string>();
  const organization = organizations.find(
    (item) => item.id === scope.organizationId,
  );
  const canAllocate = organization?.role === "tenant_admin";
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!scope.organizationId || !scope.teamBindingId || !scope.brandId)
        return;
      const version = ++readVersion.current;
      setLoading(true);
      try {
        const brandQuery = scopeQuery({
          organizationId: scope.organizationId,
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
        });
        const [brand, nextChannels, nextOrders] = await Promise.all([
          api<Account[]>(`/api/v1/balances?${brandQuery}`, { signal }),
          api<PageData<Channel>>(
            "/api/v1/publication-channels?page=1&pageSize=12",
            { signal },
          ),
          api<PublicationOrder[]>(`/api/v1/publication-orders?${brandQuery}`, {
            signal,
          }),
        ]);
        if (signal?.aborted || version !== readVersion.current) return;
        setBrandAccounts(brand);
        setChannels(nextChannels.list);
        setChannelTotal(nextChannels.pagination.total);
        setOrders(nextOrders);
        if (canAllocate) {
          const [pool, ledger] = await Promise.all([
            api<Account[]>(
              `/api/v1/balances?organizationId=${scope.organizationId}`,
              { signal },
            ),
            api<Transaction[]>(
              `/api/v1/balance-transactions?organizationId=${scope.organizationId}`,
              { signal },
            ),
          ]);
          if (signal?.aborted || version !== readVersion.current) return;
          setOrganizationAccounts(pool.filter((item) => item.brandId === null));
          setTransactions(ledger);
        }
      } catch (error) {
        if (!signal?.aborted && version === readVersion.current)
          setMessage(error instanceof Error ? error.message : "余额加载失败");
      } finally {
        if (!signal?.aborted && version === readVersion.current)
          setLoading(false);
      }
    },
    [scope.organizationId, scope.teamBindingId, scope.brandId, canAllocate],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        navigator.onLine &&
        !submitting.current
      )
        void load(controller.signal);
    };
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [load]);
  useEffect(() => {
    setTransactionUserId(undefined);
  }, [scope.organizationId]);
  const queryChannels = useCallback(async (query: PublicationChannelQuery) => {
    const params = new URLSearchParams({
      page: String(query.page),
      pageSize: String(query.pageSize),
      sort: query.sort,
    });
    if (query.q) params.set("q", query.q);
    if (query.mediaType) params.set("mediaType", query.mediaType);
    if (query.maxPriceAmount !== undefined)
      params.set("maxPriceAmount", String(query.maxPriceAmount));
    setChannelLoading(true);
    try {
      const result = await api<PageData<Channel>>(
        `/api/v1/publication-channels?${params.toString()}`,
      );
      setChannels(result.list);
      setChannelTotal(result.pagination.total);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布渠道查询失败");
    } finally {
      setChannelLoading(false);
    }
  }, []);
  async function allocate(values: AllocationForm) {
    const { asset, amount: quantity, reason } = values;
    setBusy("allocate");
    try {
      await api("/api/v1/balance-allocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: scope.organizationId,
          brandId: scope.brandId,
          asset,
          amount:
            asset === "publication_cny" ? Math.round(quantity * 100) : quantity,
          reason,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      allocationForm.resetFields();
      allocationForm.setFieldValue("asset", allocationAsset);
      await load();
      setMessage("余额已划分到当前品牌");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "余额划分失败");
    } finally {
      setBusy("");
    }
  }
  async function createOrder(values: PublicationForm) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy("publication");
    const payload = {
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      brandId: scope.brandId,
      channelId: values.channelId,
      title: values.title,
      contentUrl: values.contentUrl || undefined,
      contentHtml: values.contentHtml || undefined,
      sourceJobId: sourceJobId || undefined,
      sourceDocumentId: sourceDocumentId || undefined,
      note: values.note,
    };
    try {
      const result = await api<{
        order: PublicationOrder["order"];
        replayed: boolean;
      }>("/api/v1/publication-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey: attempt.current.key(payload),
        }),
      });
      if (
        result.order.status === "submitted" &&
        selectedChannel?.provider === "frog_media"
      ) {
        await load();
        setMessage("该投稿仍在确认中，请核对订单，不要重复投稿。");
        return;
      }
      attempt.current.complete();
      publicationForm.resetFields();
      setSelectedChannel(undefined);
      setSourceJobId(undefined);
      setSourceDocumentId(undefined);
      await load();
      setMessage(
        ["failed", "cancelled"].includes(result.order.status)
          ? "原发布订单已终止，余额已返还；确认修改后可重新下单。"
          : "发布订单已提交，人民币余额已扣减",
      );
    } catch (error) {
      const failure =
        error instanceof Error ? error.message : "发布订单提交失败";
      await load();
      setMessage(failure);
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }
  async function cancelOrder(orderId: string) {
    setBusy(`cancel-${orderId}`);
    try {
      await api(`/api/v1/publication-orders/${orderId}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: scope.organizationId,
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
        }),
      });
      await load();
      setMessage("发布订单已取消，发布余额已返还");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消发布订单失败");
    } finally {
      setBusy("");
    }
  }
  async function appealOrder(values: AppealForm) {
    if (!appealOrderId) return;
    setBusy(`appeal-${appealOrderId}`);
    try {
      await api(`/api/v1/publication-orders/${appealOrderId}/appeal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId: scope.organizationId,
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
          reason: values.reason,
          detail: values.detail || undefined,
        }),
      });
      setAppealOrderId(undefined);
      appealForm.resetFields();
      await load();
      setMessage("发布申诉已提交");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "发布申诉提交失败");
    } finally {
      setBusy("");
    }
  }
  const brandPoints =
    brandAccounts.find((item) => item.asset === "answerbit_points")?.balance ??
    0;
  const brandMoney =
    brandAccounts.find((item) => item.asset === "publication_cny")?.balance ??
    0;
  const publicationBalanceInsufficient = Boolean(
    selectedChannel && selectedChannel.priceAmount > brandMoney,
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
  const orderColumns: TableColumnsType<PublicationOrder> = [
    {
      title: "提交时间",
      dataIndex: ["order", "createdAt"],
      width: 180,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: "内容",
      key: "content",
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{item.order.title}</Typography.Text>
          <Typography.Text type="secondary">
            {item.channel.category + " · " + item.channel.name}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "费用",
      dataIndex: ["order", "priceAmount"],
      width: 120,
      render: (value: number) => money(value),
    },
    {
      title: "状态",
      key: "status",
      width: 180,
      render: (_, item) => (
        <Space direction="vertical" size={0}>
          <Tag
            color={
              item.order.status === "published"
                ? "success"
                : item.order.status === "failed" ||
                    item.order.status === "cancelled"
                  ? "default"
                  : "processing"
            }
          >
            {item.order.status}
          </Tag>
          {item.order.providerMessage ? (
            <Typography.Text ellipsis type="secondary">
              {item.order.providerMessage}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "结果",
      dataIndex: ["order", "resultUrl"],
      width: 100,
      render: (value: string | null) =>
        value ? (
          <Typography.Link href={value} rel="noreferrer" target="_blank">
            查看结果
          </Typography.Link>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: "操作",
      key: "action",
      width: 110,
      render: (_, item) => (
        <Space>
          {scope.canWrite &&
          (item.order.status === "submitted" ||
            item.order.status === "processing") ? (
            <Popconfirm
              cancelText="保留订单"
              okText="确认取消"
              onConfirm={() => void cancelOrder(item.order.id)}
              title="取消后将向聚合发布上游申请取消，并返还本地发布余额。"
            >
              <Button
                danger
                loading={busy === `cancel-${item.order.id}`}
                size="small"
              >
                取消
              </Button>
            </Popconfirm>
          ) : null}
          {scope.canWrite &&
          item.order.providerOrderId &&
          (item.order.status === "processing" ||
            item.order.status === "published") ? (
            <Button
              onClick={() => {
                appealForm.resetFields();
                setAppealOrderId(item.order.id);
              }}
              size="small"
            >
              申诉
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const transactionColumns: TableColumnsType<Transaction> = [
    {
      title: "发生时间",
      dataIndex: "createdAt",
      width: 180,
      render: (value: string) => new Date(value).toLocaleString(),
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

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      <Row gutter={[16, 16]}>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic title="腾讯能力积分" value={brandPoints} />
            <Typography.Text type="secondary">
              调用成功后按规则扣减
            </Typography.Text>
          </Card>
        </Col>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic
              formatter={() => money(brandMoney)}
              title="发布人民币余额"
              value={brandMoney}
            />
            <Typography.Text type="secondary">仅用于媒体发布</Typography.Text>
          </Card>
        </Col>
        {canAllocate
          ? organizationAccounts.map((item) => (
              <Col key={item.id} lg={8} sm={12} xs={24}>
                <Card>
                  <Statistic
                    formatter={() =>
                      item.asset === "answerbit_points"
                        ? item.balance.toLocaleString()
                        : money(item.balance)
                    }
                    title={
                      item.asset === "answerbit_points"
                        ? "企业可分配积分"
                        : "企业可分配发布余额"
                    }
                    value={item.balance}
                  />
                  <Typography.Text type="secondary">
                    由企业管理员划分
                  </Typography.Text>
                </Card>
              </Col>
            ))
          : null}
      </Row>

      <Card title="业务范围">
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

      <Card
        extra={
          <Button
            loading={loading}
            icon={<ReloadOutlined />}
            onClick={() => void load()}
          >
            刷新
          </Button>
        }
        title="发布订单"
      >
        <AccessibleTable<PublicationOrder>
          columns={orderColumns}
          dataSource={orders}
          locale={{
            emptyText: (
              <Empty
                description="暂无发布订单"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={false}
          rowKey={(item) => item.order.id}
          scroll={{ x: 800 }}
          scrollRegionLabel="发布订单，可横向滚动"
        />
      </Card>

      {canAllocate ? (
        <Card
          extra={
            <Select
              allowClear
              aria-label="按操作用户筛选余额流水"
              onChange={setTransactionUserId}
              options={transactionUsers}
              placeholder="全部用户"
              showSearch
              style={{ minWidth: 220 }}
              value={transactionUserId}
            />
          }
          title="余额流水"
        >
          <AccessibleTable<Transaction>
            columns={transactionColumns}
            dataSource={visibleTransactions}
            locale={{
              emptyText: (
                <Empty
                  description="暂无余额流水"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            rowKey="id"
            scroll={{ x: 760 }}
            scrollRegionLabel="余额流水，可横向滚动"
          />
        </Card>
      ) : null}
      <Row align="stretch" gutter={[16, 16]}>
        {canAllocate ? (
          <Col lg={10} xs={24}>
            <Card title="向当前品牌划分余额">
              <Form<AllocationForm>
                form={allocationForm}
                initialValues={{ asset: "answerbit_points" }}
                layout="vertical"
                onFinish={(values) => void allocate(values)}
              >
                <Form.Item
                  htmlFor="billing-allocation-asset"
                  label="余额类型（必选）"
                  name="asset"
                  rules={[
                    {
                      validator: (_, value) =>
                        value
                          ? Promise.resolve()
                          : Promise.reject(new Error("请选择余额类型")),
                    },
                  ]}
                >
                  <Select
                    id="billing-allocation-asset"
                    onChange={(value: Asset) => setAllocationAsset(value)}
                    options={[
                      {
                        label: "腾讯能力积分",
                        value: "answerbit_points",
                      },
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
                  rules={[{ required: true, message: "请输入划分数量" }]}
                >
                  <InputNumber
                    min={allocationAsset === "publication_cny" ? 0.01 : 1}
                    precision={allocationAsset === "publication_cny" ? 2 : 0}
                    step={allocationAsset === "publication_cny" ? 0.01 : 1}
                    style={{ width: "100%" }}
                  />
                </Form.Item>
                <Form.Item
                  label="划分说明"
                  name="reason"
                  rules={[
                    { required: true, message: "请输入划分说明" },
                    { min: 4, message: "至少输入 4 个字符" },
                  ]}
                >
                  <Input />
                </Form.Item>
                <Button
                  block
                  htmlType="submit"
                  loading={busy === "allocate"}
                  type="primary"
                >
                  确认划分
                </Button>
              </Form>
            </Card>
          </Col>
        ) : null}

        <Col lg={canAllocate ? 14 : 24} xs={24}>
          <Card
            extra={
              <Tag color="green">
                已接入 {channelTotal.toLocaleString()} 个渠道
              </Tag>
            }
            id="publication"
            title="提交媒体发布"
          >
            <Form<PublicationForm>
              form={publicationForm}
              initialValues={{
                title: initialPublication.title,
                note: initialPublication.note,
              }}
              layout="vertical"
              disabled={!scope.canWrite || Boolean(busy)}
              onFinish={(values) => void createOrder(values)}
            >
              <Form.Item
                htmlFor="billing-publication-channel"
                label="发布渠道（必选）"
                name="channelId"
                rules={[
                  {
                    validator: (_, value) =>
                      value
                        ? Promise.resolve()
                        : Promise.reject(new Error("请选择发布渠道")),
                  },
                ]}
              >
                <PublicationChannelPicker
                  channels={channels}
                  total={channelTotal}
                  loading={channelLoading}
                  disabled={!scope.canWrite || Boolean(busy)}
                  id="billing-publication-channel"
                  onQuery={queryChannels}
                  onSelect={setSelectedChannel}
                  selectedChannel={selectedChannel}
                />
              </Form.Item>
              <Form.Item
                label="内容标题"
                name="title"
                rules={[
                  { required: true, message: "请输入内容标题" },
                  { min: 2, max: 255 },
                ]}
              >
                <Input />
              </Form.Item>
              <Form.Item
                label="内容链接"
                name="contentUrl"
                rules={[{ type: "url" }]}
              >
                <Input placeholder="https://" />
              </Form.Item>
              {sourceJobId || sourceDocumentId ? (
                <Alert
                  message={
                    sourceDocumentId
                      ? "将使用文档库中已定稿的正文投稿"
                      : "将使用已审核生成任务的 HTML 正文投稿"
                  }
                  action={
                    <Button
                      onClick={() => {
                        setSourceJobId(undefined);
                        setSourceDocumentId(undefined);
                      }}
                    >
                      改用手动正文
                    </Button>
                  }
                  showIcon
                  style={{ marginBottom: 20 }}
                  type="success"
                />
              ) : (
                <Form.Item
                  label="HTML 正文"
                  name="contentHtml"
                  rules={[
                    {
                      required: selectedChannel?.provider === "frog_media",
                      message: "请输入 HTML 正文，或从已完成的生成任务进入发布",
                    },
                  ]}
                >
                  <Input.TextArea
                    placeholder="<p>请输入待发布正文</p>"
                    rows={10}
                  />
                </Form.Item>
              )}
              <Form.Item label="发布要求" name="note">
                <Input.TextArea
                  maxLength={2000}
                  placeholder="可填写频道、来源、署名、图片处理等补充要求"
                  rows={4}
                  showCount
                />
              </Form.Item>
              {publicationBalanceInsufficient ? (
                <Alert
                  message={`当前发布余额 ${money(brandMoney)}，不足以支付 ${money(selectedChannel!.priceAmount)}`}
                  showIcon
                  style={{ marginBottom: 16 }}
                  type="warning"
                />
              ) : null}
              <Row align="middle" gutter={[12, 12]} justify="space-between">
                <Col>
                  <Typography.Text type="secondary">
                    {selectedChannel
                      ? `提交后扣除 ${money(selectedChannel.priceAmount)}；失败或确认取消自动退回`
                      : "选择渠道后显示实时价格与履约指标"}
                  </Typography.Text>
                </Col>
                <Col>
                  <Button
                    disabled={
                      !scope.brandId ||
                      !scope.canWrite ||
                      publicationBalanceInsufficient
                    }
                    htmlType="submit"
                    icon={<SendOutlined />}
                    loading={busy === "publication"}
                    size="large"
                    type="primary"
                  >
                    确认并提交发布
                  </Button>
                </Col>
              </Row>
            </Form>
          </Card>
        </Col>
      </Row>

      <Modal
        forceRender
        cancelText="取消"
        confirmLoading={Boolean(
          appealOrderId && busy === `appeal-${appealOrderId}`,
        )}
        okText="提交申诉"
        onCancel={() => setAppealOrderId(undefined)}
        onOk={() => appealForm.submit()}
        open={Boolean(appealOrderId)}
        title="聚合发布订单申诉"
      >
        <Form<AppealForm>
          form={appealForm}
          layout="vertical"
          onFinish={(values) => void appealOrder(values)}
        >
          <Form.Item
            label="申诉原因"
            name="reason"
            rules={[{ required: true, message: "请选择申诉原因" }]}
          >
            <Select
              options={[
                { label: "未收录，申请退款（包收录资源）", value: 1 },
                { label: "发布结果与案例不一致", value: 2 },
                { label: "时效内链接打不开", value: 3 },
                { label: "其他原因", value: 4 },
              ]}
            />
          </Form.Item>
          <Form.Item label="具体说明" name="detail">
            <Input.TextArea maxLength={2000} rows={4} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
