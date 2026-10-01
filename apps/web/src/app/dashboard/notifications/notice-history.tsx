"use client";
import {
  notificationListQuerySchema,
  type NotificationListQuery,
} from "@geo/contracts";
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Flex,
  List,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Notice = {
  id: string;
  type: "low_credits" | "connection_failure" | "metric_anomaly";
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  brandId: string | null;
  occurredAt: string;
  readAt: string | null;
};
type NoticePage = {
  list: Notice[];
  total: number;
  unreadCount: number;
  page: number;
  pageSize: number;
};
const typeNames = {
  low_credits: "积分不足",
  connection_failure: "连接连续失败",
  metric_anomaly: "核心指标异常",
};
const severityNames = { info: "提示", warning: "警告", critical: "严重" };
const queryKeys = {
  page: "noticePage",
  pageSize: "noticePageSize",
  type: "noticeType",
  severity: "noticeSeverity",
  unreadOnly: "noticeUnreadOnly",
  beginDate: "noticeBeginDate",
  endDate: "noticeEndDate",
} as const;

export function NoticeHistory({
  organizationId,
  brandId,
}: {
  organizationId: string;
  brandId: string;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const [navigating, startTransition] = useTransition();
  const raw: Record<string, string> = { organizationId };
  if (search.get("noticeOrganizationId") === organizationId)
    for (const [field, key] of Object.entries(queryKeys)) {
      const value = search.get(key);
      if (value) raw[field] = value;
    }
  const parsed = notificationListQuerySchema.safeParse(raw);
  const query = parsed.success
    ? parsed.data
    : notificationListQuerySchema.parse({ organizationId });
  const url = `/api/v1/notifications?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`;
  const [snapshot, setSnapshot] = useState<{ url: string; data: NoticePage }>();
  const [failure, setFailure] = useState<{ url: string; message: string }>();
  const [loading, setLoading] = useState(false),
    [readId, setReadId] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  }>();
  const controllerRef = useRef<AbortController | undefined>(undefined),
    inFlight = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setFailure(undefined);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "通知读取失败");
      if (!controller.signal.aborted && controllerRef.current === controller)
        setSnapshot({ url, data: body.data });
    } catch (error) {
      if (!controller.signal.aborted && controllerRef.current === controller)
        setFailure({
          url,
          message: error instanceof Error ? error.message : "通知读取失败",
        });
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setLoading(false);
      }
    }
  }, [url]);
  const latestLoad = useRef(load);
  useEffect(() => {
    latestLoad.current = load;
  }, [load]);
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
  const error = failure?.url === url ? failure.message : undefined;
  const data = !error && snapshot?.url === url ? snapshot.data : undefined;
  const change = (patch: Partial<NotificationListQuery>) => {
    const next = { ...query, page: 1, ...patch },
      params = new URLSearchParams(search);
    params.set("organizationId", organizationId);
    if (brandId) params.set("brandId", brandId);
    params.set("noticeOrganizationId", organizationId);
    for (const [field, key] of Object.entries(queryKeys)) {
      const value = next[field as keyof typeof queryKeys];
      if (value !== undefined) params.set(key, String(value));
      else params.delete(key);
    }
    startTransition(() =>
      router.replace(`${pathname}?${params}`, { scroll: false }),
    );
  };
  async function readAll() {
    if (inFlight.current) return;
    inFlight.current = true;
    setReadId("all");
    setMessage(undefined);
    const filters = {
      organizationId,
      type: query.type,
      severity: query.severity,
      beginDate: query.beginDate,
      endDate: query.endDate,
    };
    try {
      const response = await fetch("/api/v1/notifications/read-all", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(filters),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "批量已读保存失败");
      if (!mounted.current) return;
      setMessage({
        type: "success",
        text: body.data.count
          ? `已将当前筛选的 ${body.data.count} 条通知标为已读`
          : "当前筛选的通知均已读",
      });
      await latestLoad.current();
    } catch (error) {
      if (mounted.current)
        setMessage({
          type: "error",
          text:
            error instanceof Error ? error.message : "批量已读保存失败，请重试",
        });
    } finally {
      inFlight.current = false;
      if (mounted.current) setReadId("");
    }
  }

  async function setRead(notice: Notice) {
    if (inFlight.current) return;
    inFlight.current = true;
    setReadId(notice.id);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/v1/notifications/${notice.id}/read`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, read: !notice.readAt }),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "已读状态保存失败");
      if (!mounted.current) return;
      setMessage({
        type: "success",
        text: notice.readAt ? "通知已标为未读" : "通知已标为已读",
      });
      await latestLoad.current();
    } catch (error) {
      if (mounted.current)
        setMessage({
          type: "error",
          text:
            error instanceof Error ? error.message : "已读状态保存失败，请重试",
        });
    } finally {
      inFlight.current = false;
      if (mounted.current) setReadId("");
    }
  }
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col xs={12}>
          <Card>
            <Statistic
              title="未读通知"
              value={data?.unreadCount}
              formatter={() => (data ? data.unreadCount.toLocaleString() : "—")}
            />
          </Card>
        </Col>
        <Col xs={12}>
          <Card>
            <Statistic
              title="匹配通知"
              value={data?.total}
              formatter={() => (data ? data.total.toLocaleString() : "—")}
            />
          </Card>
        </Col>
      </Row>
      <Card
        title="站内通知"
        extra={
          <Typography.Text type="secondary">按触发时间倒序</Typography.Text>
        }
      >
        {!parsed.success ? (
          <Alert
            type="warning"
            showIcon
            message="通知筛选参数无效，请重新选择"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Flex gap={12} wrap align="flex-end" style={{ marginBottom: 20 }}>
          <Space>
            <Typography.Text>只看未读</Typography.Text>
            <Switch
              aria-label="仅显示未读通知"
              checked={query.unreadOnly}
              onChange={(unreadOnly) => change({ unreadOnly })}
            />
          </Space>
          <Select
            aria-label="按通知类型筛选"
            allowClear
            value={query.type}
            onChange={(type) => change({ type })}
            placeholder="全部类型"
            style={{ minWidth: 160, flex: "1 1 160px" }}
            options={Object.entries(typeNames).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            aria-label="按通知严重程度筛选"
            allowClear
            value={query.severity}
            onChange={(severity) => change({ severity })}
            placeholder="全部程度"
            style={{ minWidth: 140, flex: "1 1 140px" }}
            options={Object.entries(severityNames).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Flex vertical style={{ minWidth: 0, flex: "1 1 280px" }}>
            <label htmlFor="notice-begin">触发日期（北京时间）</label>
            <label
              htmlFor="notice-end"
              style={{
                position: "absolute",
                width: 1,
                height: 1,
                margin: -1,
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
              }}
            >
              通知结束日期
            </label>
            <DatePicker.RangePicker
              id={{ start: "notice-begin", end: "notice-end" }}
              allowEmpty={[true, true]}
              placeholder={["开始日期", "结束日期"]}
              value={
                query.beginDate || query.endDate
                  ? [
                      query.beginDate ? dayjs(query.beginDate) : null,
                      query.endDate ? dayjs(query.endDate) : null,
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
            onClick={() =>
              change({
                type: undefined,
                severity: undefined,
                beginDate: undefined,
                endDate: undefined,
                unreadOnly: false,
              })
            }
          >
            清除通知筛选
          </Button>
          <Button loading={loading} onClick={() => void load()}>
            刷新通知
          </Button>
        </Flex>
        {message ? (
          <Alert
            showIcon
            closable
            type={message.type}
            message={message.text}
            onClose={() => setMessage(undefined)}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {error ? (
          <Alert
            type="error"
            showIcon
            message="通知读取失败"
            description={error}
            action={
              <Button disabled={loading} onClick={() => void load()}>
                重试读取通知
              </Button>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Button
          style={{ marginBottom: 16 }}
          disabled={
            !data ||
            !data.total ||
            !data.unreadCount ||
            (Boolean(readId) && readId !== "all")
          }
          loading={readId === "all"}
          onClick={() => void readAll()}
        >
          当前筛选全部标为已读
        </Button>
        <List
          loading={loading || navigating || (!data && !error)}
          dataSource={data?.list ?? []}
          pagination={{
            current: data?.page ?? query.page,
            pageSize: query.pageSize,
            total: data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            showTotal: (total) => `共 ${total} 条通知`,
            onChange: (page, pageSize) =>
              change({
                page: pageSize === query.pageSize ? page : 1,
                pageSize,
              }),
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Typography.Text type="secondary">
                    {error
                      ? "通知暂不可用，请重试读取"
                      : query.unreadOnly
                        ? "没有符合条件的未读通知"
                        : "暂无符合条件的通知"}
                  </Typography.Text>
                }
              />
            ),
          }}
          renderItem={(notice) => (
            <List.Item
              actions={[
                <Button
                  key="read"
                  loading={readId === notice.id}
                  disabled={Boolean(readId) && readId !== notice.id}
                  onClick={() => void setRead(notice)}
                >
                  {notice.readAt ? "标为未读" : "标为已读"}
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={
                  <Badge
                    status={
                      notice.severity === "critical"
                        ? "error"
                        : notice.severity === "warning"
                          ? "warning"
                          : "processing"
                    }
                  />
                }
                title={
                  <Space wrap>
                    <Typography.Text
                      strong={!notice.readAt}
                      type={notice.readAt ? "secondary" : undefined}
                    >
                      {notice.title}
                    </Typography.Text>
                    <Tag>{typeNames[notice.type]}</Tag>
                    <Tag>{severityNames[notice.severity]}</Tag>
                    {!notice.readAt ? <Tag>未读</Tag> : null}
                  </Space>
                }
                description={
                  <Space direction="vertical" size={4}>
                    <Typography.Text>{notice.message}</Typography.Text>
                    <Typography.Text type="secondary">
                      {new Date(notice.occurredAt).toLocaleString("zh-CN", {
                        timeZone: "Asia/Shanghai",
                      })}
                      {notice.brandId ? ` · ${notice.brandId}` : ""}
                    </Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
}
