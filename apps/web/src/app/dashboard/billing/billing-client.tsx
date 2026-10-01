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
  DatePicker,
  Divider,
  Empty,
  Form,
  Flex,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { AccessibleTable } from "../../accessible-table";
import {
  ScopeFields,
  scopeQuery,
  type ScopeOrganization,
  useAnswerBitScope,
} from "../use-answerbit-scope";

import { PublicationAttempt } from "./publication-attempt";
import {
  clearPublicationDraft,
  publicationBodyHtml,
  readPublicationDraft,
  writePublicationDraft,
} from "./publication-draft";
import { type PublicationChannel } from "./publication-channel";
import styles from "./publication-form.module.css";
import { usePublicationOrderPage } from "./use-publication-order-page";

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
type LibraryDocument = {
  id: string;
  title: string;
  bodyPreview: string;
  contentLength: number;
  source: "ai_generated" | "manual" | "imported";
  updatedAt: string;
};
const money = (amount: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    amount / 100,
  );
const publicationStatusLabels: Record<string, string> = {
  submitted: "投稿确认中",
  processing: "发布处理中",
  published: "已发布",
  failed: "发布失败",
  cancelled: "已取消",
};
async function api<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "请求失败");
  return body.data as T;
}
type BillingProps = {
  userId: string;
  organizations: ScopeOrganization[];
  view: "orders" | "new";
  selectedChannelId?: string;
  initialPublication: {
    title: string;
    sourceJobId?: string;
    sourceDocumentId?: string;
    note: string;
    organizationId?: string;
    brandId?: string;
  };
};
const orderScopeQueryKeys = [
  "page",
  "pageSize",
  "keyword",
  "status",
  "beginDate",
  "endDate",
] as const;

export function BillingClient(props: BillingProps) {
  const scope = useAnswerBitScope(
    props.organizations,
    props.view === "orders" ? orderScopeQueryKeys : undefined,
  );
  const incomingMatches =
    (!props.initialPublication.organizationId ||
      props.initialPublication.organizationId === scope.organizationId) &&
    (!props.initialPublication.brandId ||
      props.initialPublication.brandId === scope.brandId);
  return (
    <BillingWorkspace
      key={`${scope.organizationId}:${scope.teamBindingId}:${scope.brandId}`}
      {...props}
      initialPublication={
        incomingMatches ? props.initialPublication : { title: "", note: "" }
      }
      scope={scope}
    />
  );
}
// @project-doc docs/domains/balance_and_publication.md#publication_state_machine
function BillingWorkspace({
  userId,
  organizations,
  initialPublication,
  selectedChannelId,
  scope,
  view,
}: BillingProps & { scope: ReturnType<typeof useAnswerBitScope> }) {
  const router = useRouter();
  const canPublish = scope.can("publication.create");
  const draftScope = useMemo(
    () => ({
      userId,
      organizationId: scope.organizationId,
      brandId: scope.brandId,
    }),
    [userId, scope.organizationId, scope.brandId],
  );
  const [restoredDraft] = useState(() => {
    if (view !== "new" || !scope.brandId) return;
    const stored = readPublicationDraft(draftScope);
    const incomingSource =
      initialPublication.sourceDocumentId || initialPublication.sourceJobId;
    const storedSource = stored?.sourceDocumentId || stored?.sourceJobId;
    return incomingSource && incomingSource !== storedSource
      ? undefined
      : stored;
  });
  const [bodyFormat, setBodyFormat] = useState<"text" | "html">(
    restoredDraft?.bodyFormat ?? "text",
  );
  const [draftSaved, setDraftSaved] = useState(Boolean(restoredDraft));
  const [submissionResult, setSubmissionResult] =
    useState<PublicationOrder["order"]>();
  const channelInitialized = useRef(false);
  const draftCleared = useRef(false);
  const restoredChannelId =
    selectedChannelId ?? restoredDraft?.values.channelId;
  const [sourceJobId, setSourceJobId] = useState(
    restoredDraft?.sourceJobId ?? initialPublication.sourceJobId,
  );
  const [sourceDocumentId, setSourceDocumentId] = useState(
    restoredDraft?.sourceDocumentId ?? initialPublication.sourceDocumentId,
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>(
    [],
  );
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryError, setLibraryError] = useState("");
  const [libraryPreview, setLibraryPreview] = useState<
    (LibraryDocument & { body: string }) | undefined
  >();
  const [libraryPreviewLoading, setLibraryPreviewLoading] = useState(false);
  const attempt = useRef(new PublicationAttempt(restoredDraft?.attempt));
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
  const orderPage = usePublicationOrderPage<PublicationOrder>(
    scope,
    view === "orders" && scope.can("publication.read"),
  );
  const [orderKeyword, setOrderKeyword] = useState(orderPage.query.keyword);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [publicationForm] = Form.useForm<PublicationForm>();
  const [appealForm] = Form.useForm<AppealForm>();
  const [appealOrderId, setAppealOrderId] = useState<string>();
  const [appealError, setAppealError] = useState("");
  function saveDraft() {
    if (view !== "new" || !scope.brandId) return;
    draftCleared.current = false;
    setDraftSaved(
      writePublicationDraft(draftScope, {
        values: publicationForm.getFieldsValue(true),
        bodyFormat,
        sourceJobId,
        sourceDocumentId,
        attempt: attempt.current.snapshot(),
        updatedAt: Date.now(),
      }),
    );
  }
  useEffect(() => {
    if (view !== "new" || !scope.brandId) return;
    // Form is mounted before restoring values or persisting source changes.
    publicationForm.setFieldsValue({
      ...restoredDraft?.values,
      channelId: restoredChannelId,
    });
  }, [publicationForm, restoredChannelId, restoredDraft, scope.brandId, view]);
  useEffect(() => {
    if (view !== "new" || !scope.brandId || draftCleared.current) return;
    setDraftSaved(
      writePublicationDraft(draftScope, {
        values: publicationForm.getFieldsValue(true),
        bodyFormat,
        sourceJobId,
        sourceDocumentId,
        attempt: attempt.current.snapshot(),
        updatedAt: Date.now(),
      }),
    );
  }, [
    bodyFormat,
    draftScope,
    publicationForm,
    sourceDocumentId,
    sourceJobId,
    view,
    scope.brandId,
  ]);
  async function loadLibrary(query = "") {
    if (!scope.brandId) return;
    setLibraryLoading(true);
    setLibraryError("");
    try {
      const result = await api<{ list: LibraryDocument[]; total: number }>(
        `/api/v1/content-documents?${scopeQuery({
          organizationId: scope.organizationId,
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
          status: "ready",
          limit: "100",
          offset: "0",
          ...(query.trim() ? { q: query.trim() } : {}),
        })}`,
        { cache: "no-store" },
      );
      setLibraryDocuments(result.list);
      setLibraryTotal(result.total);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : "文档库读取失败",
      );
    } finally {
      setLibraryLoading(false);
    }
  }
  function chooseLibraryDocument(document: LibraryDocument) {
    setSourceDocumentId(document.id);
    setSourceJobId(undefined);
    publicationForm.setFieldsValue({
      title: document.title,
      contentHtml: undefined,
    });
    setLibraryOpen(false);
    setLibraryPreview(undefined);
  }
  async function previewLibraryDocument(document: LibraryDocument) {
    setLibraryPreviewLoading(true);
    try {
      const detail = await api<LibraryDocument & { body: string }>(
        `/api/v1/content-documents/${document.id}?${scopeQuery({
          organizationId: scope.organizationId,
          teamBindingId: scope.teamBindingId,
          brandId: scope.brandId,
        })}`,
      );
      setLibraryPreview(detail);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "文档读取失败");
    } finally {
      setLibraryPreviewLoading(false);
    }
  }
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
        const [brand, channel, channelPage] = await Promise.all([
          api<Account[]>(`/api/v1/balances?${brandQuery}`, { signal }),
          view === "new" && restoredChannelId && !channelInitialized.current
            ? api<Channel>(
                `/api/v1/publication-channels/${restoredChannelId}`,
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
        if (channelPage) {
          setChannelOptions((current) => {
            const active =
              channel ??
              current.find(
                (item) =>
                  item.id === publicationForm.getFieldValue("channelId"),
              );
            return active &&
              !channelPage.list.some((item) => item.id === active.id)
              ? [active, ...channelPage.list]
              : channelPage.list;
          });
        }
        if (channel) {
          channelInitialized.current = true;
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
      restoredChannelId,
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
    if (submitting.current || !canPublish) return;
    submitting.current = true;
    setBusy("publication");
    const payload = {
      organizationId: scope.organizationId,
      teamBindingId: scope.teamBindingId,
      brandId: scope.brandId,
      channelId: values.channelId,
      title: values.title,
      contentUrl: values.contentUrl || undefined,
      contentHtml:
        sourceJobId || sourceDocumentId
          ? undefined
          : publicationBodyHtml(values.contentHtml, bodyFormat),
      sourceJobId: sourceJobId || undefined,
      sourceDocumentId: sourceDocumentId || undefined,
      note: values.note,
    };
    const idempotencyKey = attempt.current.key(payload);
    saveDraft();
    try {
      const result = await api<{
        order: PublicationOrder["order"];
        replayed: boolean;
      }>("/api/v1/publication-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          idempotencyKey,
        }),
      });
      setSubmissionResult(result.order);
      if (
        result.order.status === "submitted" &&
        selectedChannel?.provider === "frog_media"
      ) {
        await load();
        setMessage("该投稿仍在确认中，请核对订单，不要重复投稿。");
        return;
      }
      attempt.current.complete();
      if (["failed", "cancelled"].includes(result.order.status)) {
        saveDraft();
        await load();
        setMessage("发布未完成，余额已返还。稿件已保留，可修改后重新提交。");
        return;
      }
      publicationForm.resetFields();
      draftCleared.current = true;
      publicationForm.setFieldsValue({
        title: "",
        note: "",
        contentHtml: "",
        contentUrl: "",
        channelId: undefined,
      });
      setSelectedChannel(undefined);
      setSourceJobId(undefined);
      setSourceDocumentId(undefined);
      clearPublicationDraft(draftScope);
      setDraftSaved(false);
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
    if (submitting.current || !canPublish) return;
    submitting.current = true;
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
      await Promise.all([load(), orderPage.refresh()]);
      setMessage("发布订单已取消，发布余额已返还");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消发布订单失败");
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }
  async function appealOrder(values: AppealForm) {
    if (!appealOrderId || submitting.current || !canPublish) return;
    submitting.current = true;
    setAppealError("");
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
      await Promise.all([load(), orderPage.refresh()]);
      setMessage("发布申诉已提交");
    } catch (error) {
      const failure =
        error instanceof Error ? error.message : "发布申诉提交失败";
      setAppealError(failure);
      setMessage(failure);
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }
  const publicationPermissionNotice = (operation: string) =>
    canPublish ? null : (
      <Alert
        type="warning"
        showIcon
        message={
          scope.serviceUnavailable
            ? `当前企业服务不可用，暂时无法${operation}`
            : `当前品牌已没有${operation}权限`
        }
        description="原输入已保留，恢复权限或服务后可继续操作。"
        action={
          <Button
            disabled={Boolean(busy)}
            loading={scope.brandsLoading}
            onClick={() => {
              router.refresh();
              if (!scope.serviceUnavailable) scope.reloadBrands();
            }}
          >
            重新检查权限
          </Button>
        }
        style={{ marginBottom: 16 }}
      />
    );
  const brandMoney =
    brandAccounts.find((item) => item.asset === "publication_cny")?.balance ??
    0;
  const publicationBalanceInsufficient = Boolean(
    selectedChannel && selectedChannel.priceAmount > brandMoney,
  );
  const channelLibraryParams = new URLSearchParams();
  channelLibraryParams.set("organizationId", scope.organizationId);
  channelLibraryParams.set("brandId", scope.brandId);
  if (sourceJobId) channelLibraryParams.set("sourceJobId", sourceJobId);
  if (sourceDocumentId)
    channelLibraryParams.set("sourceDocumentId", sourceDocumentId);
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
          <Typography.Text type="secondary" copyable={{ text: item.order.id }}>
            订单号 {item.order.id.slice(0, 8)}
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
            {publicationStatusLabels[item.order.status] ?? "状态待核对"}
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
      width: 180,
      render: (_, item) => (
        <Space wrap>
          {scope.canWrite &&
          scope.can("publication.read") &&
          item.order.status === "published" &&
          item.order.resultUrl ? (
            <Button
              href={`/dashboard/content?${new URLSearchParams({
                organizationId: scope.organizationId,
                brandId: scope.brandId,
                stage: "trace",
                publicationOrderId: item.order.id,
              })}`}
              size="small"
            >
              加入效果追踪
            </Button>
          ) : null}
          {scope.can("publication.create") &&
          (item.order.status === "submitted" ||
            item.order.status === "processing") ? (
            <Popconfirm
              cancelText="保留订单"
              okText="确认取消"
              okButtonProps={{ disabled: !canPublish || Boolean(busy) }}
              onConfirm={() => void cancelOrder(item.order.id)}
              title="取消后将向聚合发布上游申请取消，并返还本地发布余额。"
            >
              <Button
                danger
                disabled={Boolean(busy)}
                loading={busy === `cancel-${item.order.id}`}
                size="small"
              >
                取消
              </Button>
            </Popconfirm>
          ) : null}
          {scope.can("publication.create") &&
          item.order.providerOrderId &&
          (item.order.status === "processing" ||
            item.order.status === "published") ? (
            <Button
              disabled={Boolean(busy)}
              onClick={() => {
                if (submitting.current) return;
                setAppealError("");
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
      {view === "new" && submissionResult ? (
        <Alert
          type={
            submissionResult.status === "submitted"
              ? "warning"
              : ["failed", "cancelled"].includes(submissionResult.status)
                ? "error"
                : "success"
          }
          showIcon
          message={`订单 ${submissionResult.id.slice(0, 8)} · ${submissionResult.status === "submitted" ? "投稿确认中" : ["failed", "cancelled"].includes(submissionResult.status) ? "发布未完成" : "已提交发布"}`}
          action={
            <Button
              onClick={() =>
                router.push(
                  `/dashboard/publication/orders?${scopeQuery({ organizationId: scope.organizationId, brandId: scope.brandId })}`,
                )
              }
            >
              查看订单
            </Button>
          }
        />
      ) : null}

      {view === "orders" ? (
        <Card
          extra={
            <Button
              loading={orderPage.loading}
              icon={<ReloadOutlined aria-hidden="true" />}
              onClick={() => void orderPage.refresh()}
            >
              刷新
            </Button>
          }
          title="发布订单"
        >
          <Form
            layout="vertical"
            disabled={!scope.brandId || !scope.can("publication.read")}
          >
            <Row gutter={[16, 8]}>
              <Col lg={9} md={12} xs={24}>
                <Form.Item label="查找订单" htmlFor="publication-order-keyword">
                  <Input.Search
                    id="publication-order-keyword"
                    maxLength={255}
                    placeholder="文章标题、媒体或订单编号"
                    value={orderKeyword}
                    onChange={(event) => setOrderKeyword(event.target.value)}
                    onSearch={(keyword) =>
                      orderPage.update({
                        keyword: keyword.trim(),
                        page: 1,
                      })
                    }
                    allowClear
                  />
                </Form.Item>
              </Col>
              <Col lg={5} md={12} xs={24}>
                <Form.Item label="订单状态" htmlFor="publication-order-status">
                  <Select
                    id="publication-order-status"
                    allowClear
                    placeholder="全部状态"
                    value={orderPage.query.status}
                    options={Object.entries(publicationStatusLabels).map(
                      ([value, label]) => ({ value, label }),
                    )}
                    onChange={(status) => orderPage.update({ status, page: 1 })}
                  />
                </Form.Item>
              </Col>
              <Col lg={10} md={24} xs={24}>
                <Form.Item label="提交日期" htmlFor="publication-order-begin">
                  <DatePicker.RangePicker
                    id={{
                      start: "publication-order-begin",
                      end: "publication-order-end",
                    }}
                    placeholder={["开始日期", "结束日期"]}
                    disabledDate={(date) => date.isAfter(dayjs(), "day")}
                    value={
                      orderPage.query.beginDate && orderPage.query.endDate
                        ? [
                            dayjs(orderPage.query.beginDate),
                            dayjs(orderPage.query.endDate),
                          ]
                        : null
                    }
                    presets={[
                      {
                        label: "近 7 天",
                        value: [dayjs().subtract(6, "day"), dayjs()],
                      },
                      {
                        label: "近 30 天",
                        value: [dayjs().subtract(29, "day"), dayjs()],
                      },
                    ]}
                    onChange={(range) =>
                      orderPage.update({
                        page: 1,
                        beginDate: range?.[0]?.format("YYYY-MM-DD"),
                        endDate: range?.[1]?.format("YYYY-MM-DD"),
                      })
                    }
                    style={{ width: "100%" }}
                  />
                  <label
                    htmlFor="publication-order-end"
                    style={{
                      position: "absolute",
                      width: 1,
                      height: 1,
                      overflow: "hidden",
                      clipPath: "inset(50%)",
                    }}
                  >
                    提交结束日期
                  </label>
                </Form.Item>
              </Col>
            </Row>
            <Flex
              justify="space-between"
              align="center"
              wrap
              gap={8}
              style={{ marginBottom: 16 }}
            >
              <Typography.Text type="secondary">
                {orderPage.query.keyword
                  ? `关键词：${orderPage.query.keyword} · `
                  : ""}
                共 {orderPage.pagination.total} 条订单
              </Typography.Text>
              <Button
                onClick={() => {
                  setOrderKeyword("");
                  orderPage.update({
                    keyword: "",
                    status: undefined,
                    beginDate: undefined,
                    endDate: undefined,
                    page: 1,
                  });
                }}
              >
                清除筛选
              </Button>
            </Flex>
          </Form>
          {orderPage.error ? (
            <Alert
              type="error"
              showIcon
              message={orderPage.error}
              action={
                <Button onClick={() => void orderPage.refresh()}>重试</Button>
              }
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <AccessibleTable<PublicationOrder>
            columns={orderColumns}
            dataSource={orderPage.list}
            loading={orderPage.loading}
            locale={{
              emptyText: (
                <Empty
                  description={
                    orderPage.query.keyword ||
                    orderPage.query.status ||
                    orderPage.query.beginDate
                      ? "没有符合筛选条件的订单"
                      : "暂无发布订单"
                  }
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
            pagination={{
              current: orderPage.pagination.page,
              pageSize: orderPage.pagination.pageSize,
              total: orderPage.pagination.total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50, 100],
              showTotal: (total) => `共 ${total} 条`,
              onChange: (page, pageSize) =>
                orderPage.update({
                  page: pageSize === orderPage.query.pageSize ? page : 1,
                  pageSize,
                }),
            }}
            rowKey={(item) => item.order.id}
            scroll={{ x: 800 }}
            scrollRegionLabel="发布订单，可横向滚动"
          />
        </Card>
      ) : null}

      {view === "new" ? (
        <Form<PublicationForm>
          disabled={!scope.can("publication.create") || Boolean(busy)}
          form={publicationForm}
          initialValues={{
            title: initialPublication.title,
            note: initialPublication.note,
            ...restoredDraft?.values,
          }}
          onValuesChange={saveDraft}
          layout="vertical"
          onFinish={(values) => void createOrder(values)}
        >
          {publicationPermissionNotice("提交发布")}
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
                <Space style={{ marginBottom: 16 }} wrap>
                  <Button
                    disabled={!scope.brandId}
                    onClick={() => {
                      setLibraryOpen(true);
                      void loadLibrary();
                    }}
                  >
                    从文档库选择文章
                  </Button>
                  <Typography.Link
                    onClick={saveDraft}
                    href={`/dashboard/content?${scopeQuery({ stage: "library", organizationId: scope.organizationId, brandId: scope.brandId })}`}
                  >
                    管理文档库
                  </Typography.Link>
                </Space>
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
                        onClick={async () => {
                          if (sourceDocumentId) {
                            try {
                              const document = await api<{ body: string }>(
                                `/api/v1/content-documents/${sourceDocumentId}?${scopeQuery({ organizationId: scope.organizationId, teamBindingId: scope.teamBindingId, brandId: scope.brandId })}`,
                              );
                              publicationForm.setFieldValue(
                                "contentHtml",
                                document.body,
                              );
                              setBodyFormat("html");
                            } catch (error) {
                              setMessage(
                                error instanceof Error
                                  ? error.message
                                  : "正文读取失败",
                              );
                              return;
                            }
                          }
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
                    label={
                      <Flex gap={12} align="center" wrap>
                        <span>文章正文</span>
                        <Segmented
                          size="small"
                          options={[
                            { label: "普通正文", value: "text" },
                            { label: "HTML", value: "html" },
                          ]}
                          value={bodyFormat}
                          onChange={(value) =>
                            setBodyFormat(value as "text" | "html")
                          }
                        />
                      </Flex>
                    }
                    name="contentHtml"
                    rules={[
                      {
                        required: selectedChannel?.provider === "frog_media",
                        message: "请输入文章正文，或从文档库选择文章",
                      },
                    ]}
                  >
                    <Input.TextArea
                      maxLength={500000}
                      placeholder={
                        bodyFormat === "html"
                          ? "<p>请输入待发布正文</p>"
                          : "粘贴或输入文章正文，段落将自动排版"
                      }
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
                    onClick={saveDraft}
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
                    <Alert
                      message="当前发布余额不足"
                      description={
                        organizations.find(
                          (item) => item.id === scope.organizationId,
                        )?.role === "tenant_admin" ? (
                          <Typography.Link
                            onClick={saveDraft}
                            href={`/dashboard/balances?${scopeQuery({ organizationId: scope.organizationId, brandId: scope.brandId })}`}
                          >
                            前往资产划拨，为当前品牌分配发布余额
                          </Typography.Link>
                        ) : (
                          "请联系企业管理员为当前品牌划拨发布余额。"
                        )
                      }
                      showIcon
                      type="warning"
                    />
                  ) : null}

                  <Button
                    block
                    className={styles.submitButton}
                    disabled={
                      !scope.brandId ||
                      !scope.can("publication.create") ||
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
                  {draftSaved ? (
                    <Typography.Text type="secondary">
                      草稿已保存在当前标签页
                    </Typography.Text>
                  ) : null}
                </Card>
              </div>
            </Col>
          </Row>
        </Form>
      ) : null}

      <Modal
        footer={null}
        onCancel={() => setLibraryOpen(false)}
        open={libraryOpen}
        title="选择已定稿文章"
        width={760}
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Input.Search
            enterButton="搜索"
            onSearch={(value) => void loadLibrary(value)}
            placeholder="搜索文档标题或正文"
          />
          {libraryError ? (
            <Alert message={libraryError} showIcon type="error" />
          ) : null}
          <List
            dataSource={libraryDocuments}
            loading={libraryLoading}
            locale={{ emptyText: "当前品牌没有已定稿文章" }}
            renderItem={(document) => (
              <List.Item
                actions={[
                  <Button
                    key="preview"
                    loading={libraryPreviewLoading}
                    onClick={() => void previewLibraryDocument(document)}
                    type="link"
                  >
                    查看
                  </Button>,
                  <Button
                    disabled={document.contentLength === 0}
                    key="choose"
                    onClick={() => chooseLibraryDocument(document)}
                    type="link"
                  >
                    用于发布
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  description={document.bodyPreview || "暂无正文预览"}
                  title={
                    <Space wrap>
                      <Typography.Text strong>{document.title}</Typography.Text>
                      <Tag>
                        {document.source === "ai_generated"
                          ? "腾讯 AI 生成"
                          : document.source === "imported"
                            ? "外部导入"
                            : "本平台创作"}
                      </Tag>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
          {libraryTotal > 100 ? (
            <Typography.Text type="secondary">
              当前显示前 100 篇；可通过搜索找到更多文章。
            </Typography.Text>
          ) : null}
        </Space>
      </Modal>

      <Modal
        footer={
          <Button
            onClick={() =>
              libraryPreview && chooseLibraryDocument(libraryPreview)
            }
            type="primary"
          >
            使用这篇文章
          </Button>
        }
        onCancel={() => setLibraryPreview(undefined)}
        open={Boolean(libraryPreview)}
        title={libraryPreview?.title ?? "文档预览"}
        width={760}
      >
        <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
          {libraryPreview?.body}
        </Typography.Paragraph>
      </Modal>

      <Modal
        forceRender
        cancelText="取消"
        confirmLoading={Boolean(
          appealOrderId && busy === `appeal-${appealOrderId}`,
        )}
        okText="提交申诉"
        okButtonProps={{
          disabled: !canPublish || Boolean(busy),
          "aria-label": "提交申诉",
        }}
        cancelButtonProps={{ disabled: Boolean(busy) }}
        closable={!busy}
        maskClosable={!busy}
        keyboard={!busy}
        onCancel={() => {
          if (!submitting.current) setAppealOrderId(undefined);
        }}
        onOk={() => appealForm.submit()}
        open={Boolean(appealOrderId)}
        title="聚合发布订单申诉"
      >
        {publicationPermissionNotice("提交发布申诉")}
        {appealError ? (
          <Alert
            type="error"
            showIcon
            message={appealError}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Form<AppealForm>
          disabled={Boolean(busy)}
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
              disabled={!canPublish || Boolean(busy)}
              options={[
                { label: "未收录，申请退款（包收录资源）", value: 1 },
                { label: "发布结果与案例不一致", value: 2 },
                { label: "时效内链接打不开", value: 3 },
                { label: "其他原因", value: 4 },
              ]}
            />
          </Form.Item>
          <Form.Item label="具体说明" name="detail">
            <Input.TextArea
              readOnly={!canPublish}
              maxLength={2000}
              rows={4}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
