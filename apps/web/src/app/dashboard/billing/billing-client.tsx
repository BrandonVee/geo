"use client";

import {
  GlobalOutlined,
  ReloadOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Form,
  Input,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibleTable } from "../../accessible-table";
import {
  ScopeFields,
  scopeQuery,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";

import { PublicationAttempt } from "./publication-attempt";
import { type PublicationChannel } from "./publication-channel";
import styles from "./publication-form.module.css";

type Asset = "answerbit_points" | "publication_cny";
type Account = {
  id: string;
  brandId: string | null;
  asset: Asset;
  balance: number;
};
type Channel = PublicationChannel;
type PageData<T> = {
  list: T[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
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
type PublicationForm = {
  channelId: string;
  title: string;
  contentUrl?: string;
  contentHtml?: string;
  note?: string;
};
type AppealForm = { reason: 1 | 2 | 3 | 4; detail?: string };
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
  view: "orders" | "new";
  selectedChannelId?: string;
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
  selectedChannelId,
  scope,
  view,
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
  const channelSearchVersion = useRef(0);
  const channelSearchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelSearchError, setChannelSearchError] = useState("");
  const [brandAccounts, setBrandAccounts] = useState<Account[]>([]);
  const [channelOptions, setChannelOptions] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel>();
  const [channelEditing, setChannelEditing] = useState(false);
  const [orders, setOrders] = useState<PublicationOrder[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [publicationForm] = Form.useForm<PublicationForm>();
  const [appealForm] = Form.useForm<AppealForm>();
  const [appealOrderId, setAppealOrderId] = useState<string>();
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
        const [brand, nextOrders, channel, channelPage] = await Promise.all([
          api<Account[]>(`/api/v1/balances?${brandQuery}`, { signal }),
          view === "orders"
            ? api<PublicationOrder[]>(
                `/api/v1/publication-orders?${brandQuery}`,
                { signal },
              )
            : Promise.resolve([]),
          view === "new" && selectedChannelId
            ? api<Channel>(
                `/api/v1/publication-channels/${selectedChannelId}`,
                { signal },
              )
            : Promise.resolve(undefined),
          view === "new"
            ? api<PageData<Channel>>(
                "/api/v1/publication-channels?page=1&pageSize=20&sort=recommended",
                { cache: "no-store", signal },
              )
            : Promise.resolve(undefined),
        ]);
        if (signal?.aborted || version !== readVersion.current) return;
        setBrandAccounts(brand);
        setOrders(nextOrders);
        if (channelPage) {
          setChannelOptions(
            channel && !channelPage.list.some((item) => item.id === channel.id)
              ? [channel, ...channelPage.list]
              : channelPage.list,
          );
        }
        if (channel) {
          setSelectedChannel(channel);
          setChannelEditing(false);
          publicationForm.setFieldValue("channelId", channel.id);
        }
      } catch (error) {
        if (!signal?.aborted && version === readVersion.current)
          setMessage(error instanceof Error ? error.message : "余额加载失败");
      } finally {
        if (!signal?.aborted && version === readVersion.current)
          setLoading(false);
      }
    },
    [
      publicationForm,
      scope.organizationId,
      scope.teamBindingId,
      scope.brandId,
      selectedChannelId,
      view,
    ],
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
  const searchChannels = useCallback(
    async (keyword: string) => {
      const version = ++channelSearchVersion.current;
      const params = new URLSearchParams({
        page: "1",
        pageSize: "20",
        sort: "recommended",
      });
      if (keyword.trim()) params.set("q", keyword.trim());
      setChannelLoading(true);
      setChannelSearchError("");
      try {
        const page = await api<PageData<Channel>>(
          `/api/v1/publication-channels?${params}`,
          { cache: "no-store" },
        );
        if (version !== channelSearchVersion.current) return;
        setChannelOptions((current) => {
          const currentId = publicationForm.getFieldValue("channelId");
          const currentChannel = current.find((item) => item.id === currentId);
          return currentChannel &&
            !page.list.some((item) => item.id === currentChannel.id)
            ? [currentChannel, ...page.list]
            : page.list;
        });
      } catch (error) {
        if (version === channelSearchVersion.current)
          setChannelSearchError(
            error instanceof Error ? error.message : "发布渠道搜索失败",
          );
      } finally {
        if (version === channelSearchVersion.current) setChannelLoading(false);
      }
    },
    [publicationForm],
  );
  function queueChannelSearch(keyword: string) {
    if (channelSearchTimer.current) clearTimeout(channelSearchTimer.current);
    channelSearchTimer.current = setTimeout(
      () => void searchChannels(keyword),
      250,
    );
  }
  function chooseChannel(channelId?: string) {
    const channel = channelOptions.find((item) => item.id === channelId);
    setSelectedChannel(channel);
    publicationForm.setFieldValue("channelId", channel?.id);
    if (channel) setChannelEditing(false);
  }
  useEffect(
    () => () => {
      if (channelSearchTimer.current) clearTimeout(channelSearchTimer.current);
      channelSearchVersion.current += 1;
    },
    [],
  );
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
  const brandMoney =
    brandAccounts.find((item) => item.asset === "publication_cny")?.balance ??
    0;
  const publicationBalanceInsufficient = Boolean(
    selectedChannel && selectedChannel.priceAmount > brandMoney,
  );
  const channelLibraryParams = new URLSearchParams();
  if (initialPublication.title)
    channelLibraryParams.set("title", initialPublication.title);
  if (sourceJobId) channelLibraryParams.set("sourceJobId", sourceJobId);
  if (sourceDocumentId)
    channelLibraryParams.set("sourceDocumentId", sourceDocumentId);
  if (initialPublication.note)
    channelLibraryParams.set("note", initialPublication.note);
  const channelLibraryHref = `/dashboard/publication/channels${channelLibraryParams.size ? `?${channelLibraryParams}` : ""}`;
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

  return (
    <Space
      direction="vertical"
      size="large"
      style={{ padding: 24, width: "100%" }}
    >
      {view === "orders" ? (
        <Row gutter={[16, 16]}>
          <Col lg={8} sm={12} xs={24}>
            <Card>
              <Statistic
                formatter={() => money(brandMoney)}
                title="当前品牌发布余额"
                value={brandMoney}
              />
              <Typography.Text type="secondary">
                提交订单时扣减，失败或确认取消后返还
              </Typography.Text>
            </Card>
          </Col>
        </Row>
      ) : null}

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

      {view === "orders" ? (
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
      ) : null}

      {view === "new" ? (
        <Form<PublicationForm>
          disabled={!scope.canWrite || Boolean(busy)}
          form={publicationForm}
          initialValues={{
            title: initialPublication.title,
            note: initialPublication.note,
          }}
          layout="vertical"
          onFinish={(values) => void createOrder(values)}
        >
          <Form.Item
            hidden
            name="channelId"
            rules={[{ required: true, message: "请选择发布渠道" }]}
          >
            <Input />
          </Form.Item>
          <Row align="top" gutter={[24, 24]}>
            <Col lg={15} xl={16} xs={24}>
              <Card
                id="publication"
                title={
                  <div className={styles.cardTitle}>
                    <span>发布内容与要求</span>
                    <small>整理需要交付给媒体的内容和补充说明</small>
                  </div>
                }
              >
                <Form.Item
                  label="内容标题"
                  name="title"
                  rules={[
                    { required: true, message: "请输入内容标题" },
                    { min: 2, max: 255 },
                  ]}
                >
                  <Input placeholder="请输入本次发布的内容标题" />
                </Form.Item>
                <Form.Item
                  label="内容链接"
                  name="contentUrl"
                  rules={[{ type: "url" }]}
                >
                  <Input placeholder="https://（选填）" />
                </Form.Item>
                {sourceJobId || sourceDocumentId ? (
                  <Alert
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
                    message={
                      sourceDocumentId
                        ? "将使用文档库中已定稿的正文投稿"
                        : "将使用已审核生成任务的 HTML 正文投稿"
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
                        message:
                          "请输入 HTML 正文，或从已完成的生成任务进入发布",
                      },
                    ]}
                  >
                    <Input.TextArea
                      placeholder="<p>请输入待发布正文</p>"
                      rows={12}
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
              </Card>
            </Col>

            <Col lg={9} xl={8} xs={24}>
              <div className={styles.publishSidebar}>
                <Card
                  title={
                    <div className={styles.cardTitle}>
                      <span>发布配置</span>
                      <small>确认媒体渠道、费用和可用余额</small>
                    </div>
                  }
                >
                  <div className={styles.configHeading}>
                    <Typography.Text strong>媒体渠道</Typography.Text>
                    {selectedChannel ? (
                      <Button
                        onClick={() => setChannelEditing((current) => !current)}
                        size="small"
                        type="link"
                      >
                        {channelEditing ? "取消更换" : "更换"}
                      </Button>
                    ) : null}
                  </div>

                  {!selectedChannel || channelEditing ? (
                    <div className={styles.channelSelector}>
                      <Select
                        allowClear
                        filterOption={false}
                        loading={channelLoading || loading}
                        notFoundContent={
                          channelLoading
                            ? "正在搜索渠道…"
                            : "没有匹配的发布渠道"
                        }
                        onChange={chooseChannel}
                        onSearch={queueChannelSearch}
                        options={channelOptions.map((channel) => ({
                          label: `${channel.name} · ${channel.category} · ${money(channel.priceAmount)}`,
                          value: channel.id,
                        }))}
                        placeholder="搜索媒体名称或行业"
                        showSearch
                        value={selectedChannel?.id}
                      />
                      <Typography.Text
                        className={styles.selectorHint}
                        type={channelSearchError ? "danger" : "secondary"}
                      >
                        {channelSearchError || "选择后显示渠道要求和实时价格"}
                      </Typography.Text>
                    </div>
                  ) : (
                    <div className={styles.selectedChannel}>
                      <div className={styles.selectedChannelHeader}>
                        <Tag bordered={false} color="blue">
                          {selectedChannel.provider === "frog_media"
                            ? "聚合渠道"
                            : "人工渠道"}
                        </Tag>
                        <Typography.Text type="secondary">
                          {selectedChannel.category}
                        </Typography.Text>
                      </div>
                      <Typography.Title level={5}>
                        {selectedChannel.name}
                      </Typography.Title>
                      <Typography.Paragraph
                        ellipsis={{ rows: 3 }}
                        type="secondary"
                      >
                        {selectedChannel.remarks || "暂无额外发布要求"}
                      </Typography.Paragraph>
                    </div>
                  )}

                  <Button
                    block
                    href={channelLibraryHref}
                    icon={<GlobalOutlined />}
                    className={styles.libraryButton}
                  >
                    进入渠道库精细筛选
                  </Button>

                  <Divider />

                  <div className={styles.costSummary}>
                    <div>
                      <Typography.Text type="secondary">
                        本次发布费用
                      </Typography.Text>
                      <Typography.Text strong>
                        {selectedChannel
                          ? money(selectedChannel.priceAmount)
                          : "待选择"}
                      </Typography.Text>
                    </div>
                    <div>
                      <Typography.Text type="secondary">
                        当前品牌余额
                      </Typography.Text>
                      <Typography.Text strong>
                        {money(brandMoney)}
                      </Typography.Text>
                    </div>
                  </div>

                  {publicationBalanceInsufficient ? (
                    <Alert message="当前发布余额不足" showIcon type="warning" />
                  ) : null}

                  <Button
                    block
                    className={styles.submitButton}
                    disabled={
                      !scope.brandId ||
                      !scope.canWrite ||
                      !selectedChannel ||
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
                  <Typography.Paragraph
                    className={styles.submitHint}
                    type="secondary"
                  >
                    {selectedChannel
                      ? `提交后扣除 ${money(selectedChannel.priceAmount)}，失败或确认取消后自动退回`
                      : "选择媒体渠道后即可提交发布"}
                  </Typography.Paragraph>
                </Card>
              </div>
            </Col>
          </Row>
        </Form>
      ) : null}

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
