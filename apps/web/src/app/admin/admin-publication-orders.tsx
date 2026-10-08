"use client";

import {
  adminPublicationOrderQuerySchema,
  type AdminPublicationOrderQuery,
} from "@geo/contracts";
import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  type FormInstance,
  type TableColumnsType,
} from "antd";
import dayjs from "dayjs";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccessibleTable } from "../accessible-table";
import {
  PublicationManuscriptDrawer,
  type PublicationManuscriptTarget,
} from "../publication-manuscript-drawer";

type Status = "submitted" | "processing" | "published" | "failed" | "cancelled";
type OrderRow = {
  order: {
    id: string;
    organizationId: string;
    brandId: string;
    title: string;
    status: Status;
    priceAmount: number;
    resultUrl: string | null;
    note: string | null;
    providerOrderId: string | null;
    providerMessage: string | null;
    providerSyncedAt: string | null;
    createdAt: string;
  };
  channel: { name: string; provider: string };
  organization: { id: string; name: string };
};
type OrderPage = {
  list: OrderRow[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
};
type Fulfillment = { resultUrl?: string; note: string };
type EditingOrder = {
  row: OrderRow;
  status: "processing" | "published" | "failed";
};
const statusMeta = {
  submitted: { color: "blue", label: "投稿确认中" },
  processing: { color: "processing", label: "处理中" },
  published: { color: "success", label: "已交付" },
  failed: { color: "default", label: "失败已返还" },
  cancelled: { color: "default", label: "已取消" },
} as const;
const queryKeys = {
  page: "orderPage",
  pageSize: "orderPageSize",
  q: "orderKeyword",
  status: "orderStatus",
  provider: "orderProvider",
  organizationId: "orderOrganizationId",
  beginDate: "orderBeginDate",
  endDate: "orderEndDate",
} as const;
const money = (amount: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    amount / 100,
  );
const requiresProviderCheck = (row: OrderRow) =>
  !row.order.providerOrderId &&
  ["submitted", "processing"].includes(row.order.status);
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error?.details?.[0]?.message ??
        body.error?.message ??
        "发布订单请求失败",
    );
  return body.data as T;
}

// @project-doc docs/architecture/platform_administration.md#publication_fulfillment
export function AdminPublicationOrders({
  organizations,
  refreshVersion,
}: {
  organizations: { id: string; name: string }[];
  refreshVersion: number;
}) {
  const search = useSearchParams(),
    router = useRouter(),
    pathname = usePathname();
  const serialized = search.toString();
  const [navigating, startTransition] = useTransition();
  const query = useMemo(() => {
    const params = new URLSearchParams(serialized);
    const parsed = adminPublicationOrderQuerySchema.safeParse(
      Object.fromEntries(
        Object.entries(queryKeys)
          .filter(([, key]) => params.has(key))
          .map(([field, key]) => [field, params.get(key)]),
      ),
    );
    return parsed.success
      ? parsed.data
      : adminPublicationOrderQuerySchema.parse({});
  }, [serialized]);
  const url = `/api/v1/admin/publication-orders?${new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => [key, String(value)]),
  )}`;
  const [snapshot, setSnapshot] = useState<{ key: string; value: OrderPage }>();
  const [readFailure, setReadFailure] = useState<{
    key: string;
    message: string;
  }>();
  const [reading, setReading] = useState(false);
  const [manuscript, setManuscript] = useState<
    (PublicationManuscriptTarget & { directoryOrganizationId?: string }) | null
  >(null);
  useEffect(() => setManuscript(null), [query.organizationId]);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const [editing, setEditing] = useState<EditingOrder>();
  const [saving, setSaving] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [verified, setVerified] = useState<OrderRow>();
  const [success, setSuccess] = useState("");
  const [form] = Form.useForm<Fulfillment>();
  const update = useCallback(
    (change: Partial<AdminPublicationOrderQuery>) => {
      const params = new URLSearchParams(serialized);
      for (const [field, key] of Object.entries(queryKeys)) {
        const value = { ...query, ...change }[
          field as keyof AdminPublicationOrderQuery
        ];
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, String(value));
      }
      if (params.toString() === serialized) return;
      if (
        "organizationId" in change &&
        change.organizationId !== query.organizationId
      )
        setManuscript(null);
      controllerRef.current?.abort();
      controllerRef.current = undefined;
      setSnapshot(undefined);
      setReadFailure(undefined);
      startTransition(() =>
        router.replace(`${pathname}?${params}`, { scroll: false }),
      );
    },
    [pathname, query, router, serialized, startTransition],
  );
  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setReading(true);
    setReadFailure(undefined);
    try {
      const value = await request<OrderPage>(url, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || controllerRef.current !== controller)
        return;
      setSnapshot({ key: url, value });
      if (value.pagination.page !== query.page)
        update({ page: value.pagination.page });
    } catch (error) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setReadFailure({
          key: url,
          message: error instanceof Error ? error.message : "订单读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setReading(false);
      }
    }
  }, [url, query.page, update]);
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
  }, [refresh, refreshVersion, navigating]);
  const active = snapshot?.key === url ? snapshot.value : undefined;
  const pagination = active?.pagination ?? {
    page: query.page,
    pageSize: query.pageSize,
    total: 0,
    pages: 0,
  };
  function open(row: OrderRow, status: "processing" | "published" | "failed") {
    setEditing({ row, status });
    setWriteError("");
    setVerified(undefined);
    setSuccess("");
  }
  async function fulfill(values: Fulfillment) {
    if (!editing || saving) return;
    const { row, status } = editing;
    const input = {
      status,
      resultUrl: status === "published" ? values.resultUrl?.trim() : undefined,
      note: values.note?.trim() ?? "",
    };
    const finish = async (message: string) => {
      setEditing(undefined);
      setSuccess(message);
      setSnapshot(undefined);
      await refresh();
    };
    setSaving(true);
    setWriteError("");
    try {
      await request(`/api/v1/admin/publication-orders/${row.order.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      await finish("订单处理已完成");
    } catch (error) {
      try {
        const current = await request<OrderRow>(
          `/api/v1/admin/publication-orders/${row.order.id}`,
        );
        if (
          current.order.status === status &&
          (status !== "published" ||
            current.order.resultUrl === input.resultUrl) &&
          (current.order.note ?? "") === input.note
        ) {
          await finish("已核对订单，处理结果已保存");
          return;
        }
        setVerified(current);
      } catch {
        /* A failed read cannot confirm a write. Keep the form. */
      }
      setWriteError(
        error instanceof Error ? error.message : "订单处理未确认，请核对后重试",
      );
    } finally {
      setSaving(false);
    }
  }
  const columns: TableColumnsType<OrderRow> = [
    {
      title: "订单与企业",
      key: "order",
      width: 280,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.order.title}</Typography.Text>
          <Typography.Text>{row.organization.name}</Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: row.order.id }}>
            订单号 {row.order.id.slice(0, 8)}
          </Typography.Text>
          <Typography.Text type="secondary">
            品牌 {row.order.brandId}
          </Typography.Text>
          <Typography.Text type="secondary">
            {new Date(row.order.createdAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "渠道与费用",
      key: "channel",
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>{row.channel.name}</Typography.Text>
          <Typography.Text type="secondary">
            {money(row.order.priceAmount)} ·{" "}
            {row.channel.provider === "frog_media" ? "聚合渠道" : "人工渠道"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_, row) => (
        <Tag color={statusMeta[row.order.status].color}>
          {statusMeta[row.order.status].label}
        </Tag>
      ),
    },
    {
      title: "履约信息",
      key: "fulfillment",
      width: 240,
      render: (_, row) =>
        row.channel.provider === "frog_media" ? (
          <Space direction="vertical" size={0}>
            <Tag color={row.order.providerOrderId ? "purple" : "default"}>
              {row.order.providerOrderId
                ? "上游自动同步"
                : requiresProviderCheck(row)
                  ? "需要核对上游订单"
                  : "已结束"}
            </Tag>
            {row.order.providerOrderId ? (
              <Typography.Text
                copyable={{ text: row.order.providerOrderId }}
                type="secondary"
              >
                上游单号 {row.order.providerOrderId}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">
                {requiresProviderCheck(row)
                  ? "使用本地订单号核对上游后台"
                  : "未保存上游单号"}
              </Typography.Text>
            )}
            <Typography.Text type="secondary">
              {row.order.providerSyncedAt
                ? `最近核对 ${new Date(row.order.providerSyncedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                : "尚无核对记录"}
            </Typography.Text>
            {row.order.providerMessage ? (
              <Typography.Text type="secondary">
                {row.order.providerMessage}
              </Typography.Text>
            ) : null}
          </Space>
        ) : (
          <Tag>后台人工处理</Tag>
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_, row) => (
        <Space wrap>
          <Button
            size="small"
            onClick={() =>
              setManuscript({
                orderId: row.order.id,
                title: row.order.title,
                context: row.organization.name,
                requestUrl: `/api/v1/admin/publication-orders/${encodeURIComponent(row.order.id)}/manuscript`,
                directoryOrganizationId: query.organizationId,
              })
            }
          >
            查看稿件
          </Button>
          {row.order.resultUrl ? (
            <Button
              type="link"
              size="small"
              href={row.order.resultUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看交付结果
            </Button>
          ) : null}
          {row.channel.provider === "manual" &&
          ["submitted", "processing"].includes(row.order.status) ? (
            <>
              {row.order.status === "submitted" ? (
                <Button
                  disabled={saving}
                  size="small"
                  onClick={() => open(row, "processing")}
                >
                  开始处理
                </Button>
              ) : null}
              <Button
                disabled={saving}
                type="primary"
                size="small"
                onClick={() => open(row, "published")}
              >
                填写交付
              </Button>
              <Button
                disabled={saving}
                danger
                size="small"
                onClick={() => open(row, "failed")}
              >
                失败返还
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ];
  const uniqueOrganizations = useMemo(
    () => [...new Map(organizations.map((item) => [item.id, item])).values()],
    [organizations],
  );
  const choices =
    uniqueOrganizations.some((item) => item.id === query.organizationId) ||
    !query.organizationId
      ? uniqueOrganizations
      : [
          ...uniqueOrganizations,
          {
            id: query.organizationId,
            name: active?.list[0]?.organization.name ?? "已选择企业",
          },
        ];
  return (
    <Card
      title="订单处理与交付"
      extra={
        <Button
          icon={<ReloadOutlined aria-hidden="true" />}
          aria-label="刷新订单"
          aria-busy={reading || navigating}
          loading={reading || navigating}
          onClick={() => void refresh()}
        >
          刷新订单
        </Button>
      }
    >
      <Form layout="vertical" disabled={navigating}>
        <Row gutter={[16, 8]}>
          <Col xs={24} lg={10}>
            <Form.Item label="查找订单" htmlFor="admin-order-search">
              <Input.Search
                key={query.q}
                id="admin-order-search"
                defaultValue={query.q}
                allowClear
                maxLength={255}
                placeholder="标题、企业、媒体或订单编号"
                onSearch={(q) => update({ q: q.trim(), page: 1 })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12} lg={6}>
            <Form.Item label="所属企业" htmlFor="admin-order-organization">
              <Select
                id="admin-order-organization"
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="全部企业"
                value={query.organizationId}
                options={choices.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                onChange={(organizationId) =>
                  update({ organizationId, page: 1 })
                }
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6} lg={4}>
            <Form.Item label="履约来源" htmlFor="admin-order-provider">
              <Select
                id="admin-order-provider"
                allowClear
                placeholder="全部来源"
                value={query.provider}
                options={[
                  { value: "manual", label: "人工渠道" },
                  { value: "frog_media", label: "聚合渠道" },
                ]}
                onChange={(provider) => update({ provider, page: 1 })}
              />
            </Form.Item>
          </Col>
          <Col xs={12} md={6} lg={4}>
            <Form.Item label="订单状态" htmlFor="admin-order-status">
              <Select
                id="admin-order-status"
                allowClear
                placeholder="全部状态"
                value={query.status}
                options={Object.entries(statusMeta).map(([value, meta]) => ({
                  value,
                  label: meta.label,
                }))}
                onChange={(status) => update({ status, page: 1 })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} lg={12}>
            <Form.Item label="提交日期" htmlFor="admin-order-begin">
              <DatePicker.RangePicker
                id={{ start: "admin-order-begin", end: "admin-order-end" }}
                style={{ width: "100%" }}
                placeholder={["开始日期", "结束日期"]}
                value={
                  query.beginDate && query.endDate
                    ? [dayjs(query.beginDate), dayjs(query.endDate)]
                    : null
                }
                disabledDate={(date) => date.isAfter(dayjs(), "day")}
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
                  update({
                    page: 1,
                    beginDate: range?.[0]?.format("YYYY-MM-DD"),
                    endDate: range?.[1]?.format("YYYY-MM-DD"),
                  })
                }
              />
              <label
                htmlFor="admin-order-end"
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
            共 {pagination.total} 条订单
          </Typography.Text>
          <Space wrap>
            <Button
              onClick={() =>
                update({ page: 1, provider: "manual", status: "submitted" })
              }
            >
              待处理人工订单
            </Button>
            <Button
              onClick={() =>
                update({
                  page: 1,
                  q: "",
                  organizationId: undefined,
                  provider: undefined,
                  status: undefined,
                  beginDate: undefined,
                  endDate: undefined,
                })
              }
            >
              清除筛选
            </Button>
          </Space>
        </Flex>
      </Form>
      {success ? (
        <Alert
          type="success"
          showIcon
          message={success}
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setSuccess("")}
        />
      ) : null}
      {readFailure?.key === url ? (
        <Alert
          type="error"
          showIcon
          message={readFailure.message}
          action={<Button onClick={() => void refresh()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <AccessibleTable<OrderRow>
        columns={columns}
        dataSource={active?.list ?? []}
        loading={reading || navigating}
        rowKey={(row) => row.order.id}
        scroll={{ x: 1050 }}
        scrollRegionLabel="管理员发布订单，可横向滚动"
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) =>
            update({ page: pageSize === query.pageSize ? page : 1, pageSize }),
        }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                query.q ||
                query.status ||
                query.provider ||
                query.organizationId ||
                query.beginDate
                  ? "没有符合筛选条件的订单"
                  : "暂无发布订单"
              }
            />
          ),
        }}
      />
      <PublicationManuscriptDrawer
        target={
          manuscript?.directoryOrganizationId === query.organizationId
            ? manuscript
            : null
        }
        onClose={() => setManuscript(null)}
      />
      <Modal
        title="处理发布订单"
        width={720}
        open={Boolean(editing)}
        confirmLoading={saving}
        cancelButtonProps={{ disabled: saving }}
        okButtonProps={{
          "aria-label":
            editing?.status === "failed" ? "确认失败并返还" : "确认处理",
          "aria-busy": saving,
          danger: editing?.status === "failed",
          disabled:
            saving ||
            Boolean(
              verified &&
                (editing?.status === "processing"
                  ? verified.order.status !== "submitted"
                  : !["submitted", "processing"].includes(
                      verified.order.status,
                    )),
            ),
        }}
        okText={editing?.status === "failed" ? "确认失败并返还" : "确认处理"}
        onCancel={() => {
          if (!saving) setEditing(undefined);
        }}
        onOk={() => form.submit()}
      >
        <Typography.Paragraph strong>
          {editing?.row.order.title}
        </Typography.Paragraph>
        <Typography.Paragraph type="secondary">
          {editing?.row.organization.name} · 订单号 {editing?.row.order.id}
        </Typography.Paragraph>
        <Typography.Paragraph>
          处理为：{editing ? statusMeta[editing.status].label : ""}
        </Typography.Paragraph>
        {editing?.status === "failed" ? (
          <Alert
            type="warning"
            showIcon
            message={`确认后将原订单费用 ${money(editing.row.order.priceAmount)} 返还至原品牌余额`}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {writeError ? (
          <Alert
            type="error"
            showIcon
            message={writeError}
            description={
              verified
                ? `当前已保存状态：${statusMeta[verified.order.status].label}`
                : "本次结果尚未确认，已保留输入，请核对后重试"
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {editing ? (
          <FulfillmentForm
            form={form}
            editing={editing}
            saving={saving}
            onFinish={(values) => void fulfill(values)}
          />
        ) : null}
      </Modal>
    </Card>
  );
}

function FulfillmentForm({
  form,
  editing,
  saving,
  onFinish,
}: {
  form: FormInstance<Fulfillment>;
  editing: EditingOrder;
  saving: boolean;
  onFinish: (values: Fulfillment) => void;
}) {
  useEffect(() => {
    form.resetFields();
    form.setFieldsValue({
      resultUrl: editing.row.order.resultUrl ?? "",
      note: editing.row.order.note ?? "",
    });
  }, [editing, form]);
  return (
    <Form
      form={form}
      layout="vertical"
      size="large"
      disabled={saving}
      onFinish={onFinish}
    >
      {editing.status === "published" ? (
        <Form.Item
          name="resultUrl"
          label="发布结果 URL"
          rules={[
            { required: true, message: "请填写交付链接" },
            { type: "url", message: "请填写有效链接" },
            {
              pattern: /^https?:\/\//i,
              message: "交付链接须使用 HTTP 或 HTTPS",
            },
            { max: 2000 },
          ]}
        >
          <Input placeholder="https://" />
        </Form.Item>
      ) : null}
      <Form.Item
        name="note"
        label="处理说明"
        rules={[{ max: 2000, message: "处理说明最多 2000 字" }]}
      >
        <Input.TextArea rows={3} maxLength={2000} />
      </Form.Item>
    </Form>
  );
}
